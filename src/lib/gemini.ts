import { GoogleGenAI } from '@google/genai';
import type { Content, GenerateContentConfig, Part } from '@google/genai';
import type { CoachState, ImageAttachment, RunnerProfile, TimedContent } from './types';
import { coachTools, executeTool } from './tools';
import { FIND_GEAR, runFindGear } from './gear-tool';
import { emptyBasket, resolveProductBlocks } from './products';
import { resolveChecklistBlocks } from './checklist';
import { buildSystemInstruction } from './prompt';
import {
  RUNNING_PRESCRIPTION_RETRY_DIRECTIVE,
  assessSafety,
  containsRunningPrescription,
  mentionsDiscomfort,
} from './safety';
import {
  detectRedFlags,
  guardRedFlagReply,
  recordRedFlag,
  redFlagNotice,
  redFlagRetryDirective,
} from './red-flags';
import { stripInlineData, trimHistory } from './store';
import { extractTextToolCalls } from './tool-text';
import { cleanEnv } from './build-info';
import type { Usage } from './quota';

/**
 * ふだんの会話に使うモデル。環境変数 GEMINI_MODEL で変えられる。
 *
 * **費用のほぼ全部が、ここで決まる。**
 * 1回の返事で、固定の指示文と道具の説明あわせて約2万字（約1.3万トークン）を送る。
 * 道具を使えばそれを何度も送り直すので、実測で1通あたり入力5万トークンを超えた。
 * 上位のモデルのままでは、30人が毎日使うだけで月3〜6万円になる。
 */
const DEFAULT_MODEL = 'gemini-3-flash-preview';

/**
 * 画像を見てもらう時だけ使う、読み取りの強いモデル。環境変数 GEMINI_MODEL_VISION。
 *
 * **分けているのは人ではなく、頼みごとの重さ。**
 * 時計の画面やフォームの写真から数値を読み取るのは、取り違えると助言そのものが狂う。
 * ここだけは安いほうに倒さない。無料の人か会員かでは切り替えない。
 */
const VISION_MODEL = 'gemini-3-pro-preview';
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
    message = `モデル「${model}」がこのキーでは利用できません。環境変数 GEMINI_MODEL に、使えるモデル名を設定してください。`;
  } else if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(raw)) {
    message = 'Gemini API の利用上限に達しました。少し時間をおいてから、もう一度話しかけてください。';
  } else if (status !== undefined && status >= 500) {
    message = 'Gemini API 側で一時的な問題が起きています。少し時間をおいて、もう一度試してください。';
  } else {
    message = 'コーチへの接続がうまくいきませんでした。';
  }

  return new CoachApiError(message, raw.slice(0, 500), status);
}

/**
 * 実際に使うモデルの候補。先頭から順に試す。
 *
 * 2番目はあくまで**退避先**。そのキーで先頭のモデルが使えない時に、黙って倒れないためだけにある。
 * 費用が上がる側へ退避することもあるが、**使えなくなるよりは高いほうがまし**という判断。
 */
function candidateModels(vision: boolean): string[] {
  const primary = vision ? visionModelName() : modelName();
  const spare = vision ? modelName() : visionModelName();
  return primary === spare ? [primary] : [primary, spare];
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

function visionModelName(): string {
  return cleanEnv(process.env.GEMINI_MODEL_VISION) || VISION_MODEL;
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
  /** この1回で使った量。値段を決めるための実測に使う。 */
  usage: { input: number; output: number };
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
    // 時刻はこちらの都合で足したもの。**Content に無い項目なので、送る前に外す。**
    contents: contents.map(({ role, parts }) => ({ role, parts })),
    config: baseConfig(systemInstruction, model),
  });

  const parts: Part[] = [];
  const calls: StepResult['calls'] = [];
  let text = '';
  // 使った量は、流れてくるたびに「ここまでの合計」で届く。最後に届いたものが全体。
  const usage = { input: 0, output: 0 };

  for await (const chunk of stream) {
    const metadata = chunk.usageMetadata;
    if (metadata) {
      usage.input = metadata.promptTokenCount ?? usage.input;
      // 考えた分も、書いた分と同じく課金される。
      usage.output = (metadata.candidatesTokenCount ?? 0) + (metadata.thoughtsTokenCount ?? 0) || usage.output;
    }
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

  return { parts, text, calls, usage };
}

/**
 * 既定のモデルが使えない時だけ、退避先のモデルで1度やり直す。
 * すでに本文を流し始めた後は、二重に届いてしまうのでやり直さない。
 */
async function generateStep(
  contents: Content[],
  systemInstruction: string,
  vision: boolean,
  onDelta?: (delta: string) => void,
): Promise<StepResult> {
  const models = candidateModels(vision);
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
  /** 添付の見返し用の控えと結びつける id。保存する履歴のマーカーに埋め込む。 */
  attachmentGroupId?: string;
  now?: Date;
  onDelta?: (delta: string) => void;
}

export interface CoachTurnResult {
  state: CoachState;
  text: string;
  /** 走行メニュー混入を検知して書き直させた回数。運用の観測用。 */
  rewrites: number;
  usedTools: string[];
  /** この返事のために使った量。道具を使うと、1回の返事で何度もモデルを呼ぶ。 */
  usage: Usage;
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
  attachmentGroupId,
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

  /**
   * 画像が付いているターンか。付いていれば、読み取りの強いモデルに回す。
   *
   * ターンの途中で切り替えない。道具を使うと同じ画像を何度も送り直すことになるので、
   * 1回目と2回目で読み取りの精度が変わると、前の手順と噛み合わない返事になる。
   */
  const vision = (images ?? []).length > 0;

  const stamp = now.toISOString();
  const history: TimedContent[] = [...state.history, { role: 'user', parts: userParts, at: stamp }];

  const usedTools: string[] = [];
  const usage: Usage = { inputTokens: 0, outputTokens: 0, calls: 0 };
  let rewrites = 0;
  let retryDirective: string | null = null;
  let finalText = '';

  // 検索して見つけた商品を、このターンのあいだ持っておく。
  // モデルが書くのは名札（p1）だけなので、本当の名前と価格はここから埋める。
  const basket = emptyBasket();
  // 商品も持ち物リストも、中身を埋めるのはここ。モデルには「何を出すか」だけを書かせる。
  const resolve = (text: string) =>
    resolveChecklistBlocks(resolveProductBlocks(text, basket, now), profile, now);
  const resolveParts = (parts: Part[]): Part[] =>
    parts.map((part) =>
      typeof part.text === 'string' && !part.thought ? { ...part, text: resolve(part.text) } : part,
    );

  /**
   * 危険な兆候（胸の痛み・意識が遠のく感じ・めまい等）。**モデルが気づく前に、コードで拾う。**
   * 拾ったら記録に残す。記録があると、指示文の先頭に強制の指示が入り（safety.ts）、
   * 次の日以降も、診てもらったと分かるまで練習を出さない。
   */
  const turnFlag = detectRedFlags(userText);
  if (turnFlag) profile = recordRedFlag(profile, turnFlag, now);

  const cautious =
    assessSafety(profile, now).runningForbidden || mentionsDiscomfort(userText) || Boolean(turnFlag);

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const safety = assessSafety(profile, now);
    const strict = cautious || safety.runningForbidden || Boolean(safety.redFlag);
    const systemInstruction = retryDirective
      ? `${buildSystemInstruction(profile, now)}\n\n${retryDirective}`
      : buildSystemInstruction(profile, now);

    const result = await generateStep(history, systemInstruction, vision, strict ? undefined : onDelta);
    usage.inputTokens += result.usage.input;
    usage.outputTokens += result.usage.output;
    usage.calls += 1;

    if (result.calls.length > 0) {
      const responseParts: Part[] = [];
      for (const call of result.calls) {
        // 商品検索だけは外の世界を叩くので、ほかのツールと分けて扱う。
        let response: Record<string, unknown>;
        if (call.name === FIND_GEAR) {
          response = await runFindGear(profile, call.args, basket, now);
        } else {
          const outcome = executeTool(profile, call.name, call.args, now);
          profile = outcome.profile;
          response = outcome.result;
        }
        usedTools.push(call.name);
        responseParts.push({
          functionResponse: { id: call.id, name: call.name, response },
        });
      }
      // 名札を埋めるのは、検索が終わってから。順番を逆にすると何も埋まらない。
      history.push({ role: 'model', parts: resolveParts(result.parts), at: stamp });
      history.push({ role: 'user', parts: responseParts, at: stamp });
      finalText += resolve(result.text);
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

    const rawStepText = recovered.calls.length > 0 || recovered.truncated ? recovered.cleaned : result.text;
    // 画面と保存の両方で、名札ではなく本当の商品が残るようにする。
    const stepText = resolve(rawStepText);
    const candidate = finalText + stepText;

    if (strict && containsRunningPrescription(candidate) && rewrites < MAX_REWRITES) {
      // 走行メニューが混ざっていた。この発言は画面に出さず、まるごと書き直させる。
      rewrites += 1;
      // 危険な兆候の時は、痛みの書き直し（フォームの仮説・代替トレーニング）ではなく、やめる・受診の方へ。
      retryDirective = safety.redFlag ? redFlagRetryDirective(safety.redFlag.record) : RUNNING_PRESCRIPTION_RETRY_DIRECTIVE;
      finalText = '';
      continue;
    }

    /**
     * **「やめる」「119」「受診」は、モデルが書き忘れても、コードで必ず届ける。**
     * 重い兆候では、決まった文言を先頭に置く。軽い兆候では、受診の話が無い時だけ足す。
     */
    const guarded = turnFlag ? guardRedFlagReply(candidate, turnFlag) : candidate;
    const prefix = guarded.endsWith(candidate) ? guarded.slice(0, guarded.length - candidate.length) : '';

    history.push({ role: 'model', parts: cleanParts(result.parts, prefix + stepText), at: new Date().toISOString() });
    finalText = guarded;

    // 慎重モードでは、ここまで一切流していない。検査を通った本文をまとめて届ける。
    if (strict) onDelta?.(finalText);
    break;
  }

  /**
   * **ループがどこで終わっても、安全の文は必ず入れる。**
   *
   * 上の検査（ループの中）を通らずにここへ来る道が2つある。
   * 道具を使った後に本文が空で終わった時と、手順の上限に達した時。
   * どちらも、本文は溜まっているので「空の時の文」にも引っかからない。
   */
  if (turnFlag) {
    const guarded = guardRedFlagReply(finalText, turnFlag);
    if (guarded !== finalText) {
      finalText = guarded;
      // 画面に出したものを、履歴にも残す。次のターンで、自分が何を言ったか分かるように。
      history.push({ role: 'model', parts: [{ text: redFlagNotice(turnFlag) }], at: new Date().toISOString() });
    }
  }

  if (!finalText.trim()) {
    finalText =
      'うまく言葉が出てきませんでした。もう一度、今の状態を聞かせてもらえますか？ どんな些細なことでも大丈夫です。';
    history.push({ role: 'model', parts: [{ text: finalText }], at: new Date().toISOString() });
    if (cautious) onDelta?.(finalText);
  }

  return {
    // 画像の本体は保存しない。読み取った数値はカルテ側に残る。
    state: { profile, history: stripInlineData(trimHistory(history), attachmentGroupId) },
    text: finalText,
    rewrites,
    usedTools,
    usage,
  };
}
