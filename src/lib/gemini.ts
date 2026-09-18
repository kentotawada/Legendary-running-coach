import { GoogleGenAI } from '@google/genai';
import type { Content, GenerateContentConfig, Part } from '@google/genai';
import type { CoachState, ImageAttachment, RunnerProfile } from './types';
import { coachTools, executeTool } from './tools';
import { buildSystemInstruction } from './prompt';
import {
  RUNNING_PRESCRIPTION_RETRY_DIRECTIVE,
  assessSafety,
  containsRunningPrescription,
  mentionsDiscomfort,
} from './safety';
import { stripInlineData, trimHistory } from './store';
import { extractTextToolCalls } from './tool-text';
import { cleanEnv } from './build-info';

const DEFAULT_MODEL = 'gemini-3-pro-preview';
/** 既定のモデルがそのキーで使えない時に、黙って倒れないための退避先。 */
const FALLBACK_MODEL = 'gemini-3-flash-preview';
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

/**
 * Gemini 側の失敗を、原因が分かる形に翻訳したもの。
 * 汎用の「うまくいきませんでした」で潰してしまうと、
 * デプロイ先で何が起きているのか誰にも分からなくなる。
 */
export class CoachApiError extends Error {
  constructor(
    message: string,
    readonly detail: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'CoachApiError';
  }
}

/** 万一メッセージにキーが混ざっても外へ出さない。 */
function redactKeys(text: string): string {
  return text.replace(/AIza[0-9A-Za-z_-]{10,}/g, 'AIza***');
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown })?.status;
  return typeof status === 'number' ? status : undefined;
}

/** そのモデルがこのキーで使えない、という類の失敗か。 */
function isModelUnavailable(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error);
  return statusOf(error) === 404 || /NOT_FOUND|not found|is not supported|not supported for/i.test(raw);
}

/**
 * 退避先のモデルを試す価値があるか。
 * 無料枠では上位モデルの割り当てが 0 で、404 ではなく 429 で返ることがある。
 * どちらも「このキーではそのモデルを使えない」と同じ意味なので、軽いモデルで一度試す。
 */
function shouldTryFallback(error: unknown): boolean {
  return isModelUnavailable(error) || statusOf(error) === 429;
}

export function describeGeminiError(error: unknown, model: string): CoachApiError {
  if (error instanceof CoachApiError) return error;

  const status = statusOf(error);
  const raw = redactKeys(error instanceof Error ? error.message : String(error));

  let message: string;
  if (/API[_ ]?key not valid|API_KEY_INVALID/i.test(raw)) {
    message =
      'GEMINI_API_KEY が無効です。Google AI Studio でキーを作り直し、環境変数を更新してから再デプロイしてください。';
  } else if (status === 403 || /PERMISSION_DENIED/i.test(raw)) {
    message =
      'この API キーでは Gemini API を呼び出せません。キーに制限（HTTPリファラ / IP）がかかっていないか、Generative Language API が有効かを確認してください。';
  } else if (isModelUnavailable(error)) {
    message = `モデル「${model}」がこのキーでは利用できません。環境変数 GEMINI_MODEL に ${FALLBACK_MODEL} を設定してみてください。`;
  } else if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(raw)) {
    message = 'Gemini API の利用上限に達しました。少し時間をおいてから、もう一度話しかけてください。';
  } else if (status !== undefined && status >= 500) {
    message = 'Gemini API 側で一時的な問題が起きています。少し時間をおいて、もう一度試してください。';
  } else {
    message = 'コーチへの接続がうまくいきませんでした。';
  }

  return new CoachApiError(message, raw.slice(0, 500), status);
}

/** 実際に使うモデルの候補。既定モデルが駄目なら退避先を試す。 */
function candidateModels(): string[] {
  const primary = modelName();
  return primary === FALLBACK_MODEL ? [primary] : [primary, FALLBACK_MODEL];
}

function getClient(): GoogleGenAI {
  // 環境変数に引用符や改行が紛れ込んでいても、そこで転ばないようにする。
  const apiKey = cleanEnv(process.env.GEMINI_API_KEY);
  if (!apiKey) throw new MissingApiKeyError();
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

function modelName(): string {
  return cleanEnv(process.env.GEMINI_MODEL) || DEFAULT_MODEL;
}

function baseConfig(systemInstruction: string, model: string): GenerateContentConfig {
  const config: GenerateContentConfig = {
    systemInstruction,
    temperature: 0.8,
    tools: [{ functionDeclarations: coachTools }],
  };

  // thinkingLevel は Gemini 3 系のパラメータ。それ以外のモデルには送らない。
  if (model.startsWith('gemini-3')) {
    const level = (cleanEnv(process.env.GEMINI_THINKING_LEVEL) || 'LOW').toUpperCase();
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
async function streamOnce(
  model: string,
  contents: Content[],
  systemInstruction: string,
  emitted: { value: boolean },
  onDelta?: (delta: string) => void,
): Promise<StepResult> {
  const stream = await getClient().models.generateContentStream({
    model,
    contents,
    config: baseConfig(systemInstruction, model),
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
      emitted.value = true;
      onDelta?.(part.text);
    }
  }

  return { parts, text, calls };
}

/**
 * 既定のモデルが使えない時だけ、退避先のモデルで1度やり直す。
 * すでに本文を流し始めた後は、二重に届いてしまうのでやり直さない。
 */
async function generateStep(
  contents: Content[],
  systemInstruction: string,
  onDelta?: (delta: string) => void,
): Promise<StepResult> {
  const models = candidateModels();
  const emitted = { value: false };

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    try {
      return await streamOnce(model, contents, systemInstruction, emitted, onDelta);
    } catch (error) {
      // キー未設定はモデルの問題ではない。翻訳せず、そのまま理由を伝える。
      if (error instanceof MissingApiKeyError) throw error;

      const isLast = index === models.length - 1;
      if (isLast || emitted.value || !shouldTryFallback(error)) {
        throw describeGeminiError(error, model);
      }
      console.warn(`[coach] モデル ${model} が使えないため ${models[index + 1]} で再試行します`);
    }
  }

  throw new CoachApiError('利用できるモデルがありませんでした。', 'no candidate model succeeded');
}

/**
 * 履歴に残す parts から、本文だけを整えたものに差し替える。
 * 思考の署名など、次のターンへ返す必要があるパートは残す。
 */
function cleanParts(parts: Part[], cleanedText: string): Part[] {
  let replaced = false;
  const next: Part[] = [];

  for (const part of parts) {
    const isVisibleText = typeof part.text === 'string' && !part.thought && !part.functionCall;
    if (!isVisibleText) {
      next.push(part);
      continue;
    }
    if (replaced) continue;
    replaced = true;
    if (cleanedText) next.push({ ...part, text: cleanedText });
  }

  return next;
}

export interface CoachTurnInput {
  state: CoachState;
  /** ユーザーの発言。初回の呼びかけを生成する場合は内部プロンプトを渡す。 */
  userText: string;
  /** ランニングアプリのスクリーンショットなど。読み取りはモデルに任せる。 */
  images?: ImageAttachment[];
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
  images,
  now = new Date(),
  onDelta,
}: CoachTurnInput): Promise<CoachTurnResult> {
  let profile: RunnerProfile = state.profile;

  // 画像はテキストより前に置く。Gemini は先に画像を見てから指示を読む方が読み取りが安定する。
  const userParts: Part[] = [
    ...(images ?? []).map((image) => ({
      inlineData: { mimeType: image.mimeType, data: image.data },
    })),
    { text: userText },
  ];

  const history: Content[] = [...state.history, { role: 'user', parts: userParts }];

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

    // モデルがツール呼び出しを本文に書いてしまうことがある。
    // 取り除くだけだと渡したはずのメニューが記録されずに消えるので、実行してから取り除く。
    const recovered = extractTextToolCalls(result.text);
    for (const call of recovered.calls) {
      const outcome = executeTool(profile, call.name, call.args, now);
      profile = outcome.profile;
      usedTools.push(`${call.name}(本文から回収)`);
    }

    const stepText = recovered.calls.length > 0 || recovered.truncated ? recovered.cleaned : result.text;
    const candidate = finalText + stepText;

    if (strict && containsRunningPrescription(candidate) && rewrites < MAX_REWRITES) {
      // 走行メニューが混ざっていた。この発言は画面に出さず、まるごと書き直させる。
      rewrites += 1;
      retryDirective = RUNNING_PRESCRIPTION_RETRY_DIRECTIVE;
      finalText = '';
      continue;
    }

    history.push({ role: 'model', parts: cleanParts(result.parts, stepText) });
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
    // 画像の本体は保存しない。読み取った数値はカルテ側に残る。
    state: { profile, history: stripInlineData(trimHistory(history)) },
    text: finalText,
    rewrites,
    usedTools,
  };
}
