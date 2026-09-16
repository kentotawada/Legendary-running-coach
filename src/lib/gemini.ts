import { GoogleGenAI } from '@google/genai';
import type { Content, GenerateContentConfig, Part } from '@google/genai';
import type { CoachState, RunnerProfile } from './types';
import { coachTools, executeTool } from './tools';
import { buildSystemInstruction } from './prompt';
import {
  RUNNING_PRESCRIPTION_RETRY_DIRECTIVE,
  assessSafety,
  containsRunningPrescription,
  mentionsDiscomfort,
} from './safety';
import { trimHistory } from './store';

const DEFAULT_MODEL = 'gemini-3-pro-preview';
/** ツール呼び出し込みの1ターンで回す上限。無限ループを防ぐ。 */
const MAX_STEPS = 6;
/** 走行メニュー混入を検知した時に、書き直させる回数。 */
const MAX_REWRITES = 1;

let client: GoogleGenAI | null = null;

export class MissingApiKeyError extends Error {
  constructor() {
    super('GEMINI_API_KEY が設定されていません。.env.local に Gemini API キーを入れてください。');
    this.name = 'MissingApiKeyError';
  }
}

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new MissingApiKeyError();
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

function modelName(): string {
  return process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

function baseConfig(systemInstruction: string): GenerateContentConfig {
  const config: GenerateContentConfig = {
    systemInstruction,
    temperature: 0.8,
    tools: [{ functionDeclarations: coachTools }],
  };

  // thinkingLevel は Gemini 3 系のパラメータ。それ以外のモデルには送らない。
  if (modelName().startsWith('gemini-3')) {
    const level = (process.env.GEMINI_THINKING_LEVEL || 'LOW').toUpperCase();
    config.thinkingConfig = { thinkingLevel: level as never };
  }

  return config;
}

interface StepResult {
  /** 履歴にそのまま積むモデル発言。thoughtSignature を落とさない。 */
  parts: Part[];
  text: string;
  calls: { name: string; args: unknown; id?: string }[];
}

/**
 * 1回分の生成。ストリームで受けつつ、履歴用に parts を組み立て直す。
 * onDelta が undefined の時は、検査してから一括で出すために外へ流さない。
 */
async function generateStep(
  contents: Content[],
  systemInstruction: string,
  onDelta?: (delta: string) => void,
): Promise<StepResult> {
  const stream = await getClient().models.generateContentStream({
    model: modelName(),
    contents,
    config: baseConfig(systemInstruction),
  });

  const parts: Part[] = [];
  const calls: StepResult['calls'] = [];
  let text = '';

  for await (const chunk of stream) {
    const chunkParts = chunk.candidates?.[0]?.content?.parts ?? [];
    for (const part of chunkParts) {
      if (part.functionCall) {
        parts.push(part);
        calls.push({
          name: part.functionCall.name ?? '',
          args: part.functionCall.args,
          id: part.functionCall.id,
        });
        continue;
      }
      if (typeof part.text !== 'string' || part.text.length === 0) {
        if (part.thoughtSignature) parts.push(part);
        continue;
      }
      if (part.thought) {
        // 思考パートは画面に出さないが、署名は次ターンへ返す必要がある。
        parts.push(part);
        continue;
      }

      const previous = parts.at(-1);
      if (previous && typeof previous.text === 'string' && !previous.thought && !previous.functionCall) {
        previous.text += part.text;
        previous.thoughtSignature = previous.thoughtSignature ?? part.thoughtSignature;
      } else {
        parts.push({ ...part });
      }
      text += part.text;
      onDelta?.(part.text);
    }
  }

  return { parts, text, calls };
}

export interface CoachTurnInput {
  state: CoachState;
  /** ユーザーの発言。初回の呼びかけを生成する場合は内部プロンプトを渡す。 */
  userText: string;
  now?: Date;
  onDelta?: (delta: string) => void;
}

export interface CoachTurnResult {
  state: CoachState;
  text: string;
  /** 走行メニュー混入を検知して書き直させた回数。運用の観測用。 */
  rewrites: number;
  usedTools: string[];
}

/**
 * コーチの1ターン。
 *
 * 痛みがある時（または痛みを訴えている発言の時）は「慎重モード」に入り、
 * 生成した文章を検査してから初めて画面に流す。走らせてしまう事故を、
 * プロンプトだけに頼らず止めるための作り。
 */
export async function runCoachTurn({
  state,
  userText,
  now = new Date(),
  onDelta,
}: CoachTurnInput): Promise<CoachTurnResult> {
  let profile: RunnerProfile = state.profile;
  const history: Content[] = [
    ...state.history,
    { role: 'user', parts: [{ text: userText }] },
  ];

  const usedTools: string[] = [];
  let rewrites = 0;
  let retryDirective: string | null = null;
  let finalText = '';

  const cautious = assessSafety(profile, now).runningForbidden || mentionsDiscomfort(userText);

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const strict = cautious || assessSafety(profile, now).runningForbidden;
    const systemInstruction = retryDirective
      ? `${buildSystemInstruction(profile, now)}\n\n${retryDirective}`
      : buildSystemInstruction(profile, now);

    const result = await generateStep(history, systemInstruction, strict ? undefined : onDelta);

    if (result.calls.length > 0) {
      history.push({ role: 'model', parts: result.parts });
      const responseParts: Part[] = [];
      for (const call of result.calls) {
        const outcome = executeTool(profile, call.name, call.args, now);
        profile = outcome.profile;
        usedTools.push(call.name);
        responseParts.push({
          functionResponse: {
            id: call.id,
            name: call.name,
            response: outcome.result,
          },
        });
      }
      history.push({ role: 'user', parts: responseParts });
      finalText += result.text;
      retryDirective = null;
      continue;
    }

    if (!result.text.trim()) {
      // 本文もツール呼び出しも無い状態。ここで止めないと空回りする。
      break;
    }

    const candidate = finalText + result.text;

    if (strict && containsRunningPrescription(candidate) && rewrites < MAX_REWRITES) {
      // 走行メニューが混ざっていた。この発言は画面に出さず、まるごと書き直させる。
      rewrites += 1;
      retryDirective = RUNNING_PRESCRIPTION_RETRY_DIRECTIVE;
      finalText = '';
      continue;
    }

    history.push({ role: 'model', parts: result.parts });
    finalText = candidate;

    // 慎重モードでは、ここまで一切流していない。検査を通った本文をまとめて届ける。
    if (strict) onDelta?.(finalText);
    break;
  }

  if (!finalText.trim()) {
    finalText =
      'うまく言葉が出てきませんでした。もう一度、今の状態を聞かせてもらえますか？ どんな些細なことでも大丈夫です。';
    history.push({ role: 'model', parts: [{ text: finalText }] });
    if (cautious) onDelta?.(finalText);
  }

  return {
    state: { profile, history: trimHistory(history) },
    text: finalText,
    rewrites,
    usedTools,
  };
}
