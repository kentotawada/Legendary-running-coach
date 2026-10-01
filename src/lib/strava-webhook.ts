/**
 * Strava から届く通知（webhook）の受け取り。
 *
 * これまでの取り込みは**こちらから取りに行く**形だった。
 * つまり、アプリを開くまで何も起きない。走り終えて風呂に入って寝た人の記録は、
 * 次に思い出して開くまで、どこにも無いのと同じだった。
 *
 * ここが入ると順番が逆になる。
 * **走り終えた数十秒後に、記録のほうから届く。** 開いた時にはもう読んである。
 * 汎用のチャットに貼り付ける形では、この順番は絶対に作れない。
 *
 * ## 気をつけていること
 *
 * - **2秒以内に200を返す。** 返さないと Strava は失敗とみなし、何度も送り直す。
 *   取り込みは返事のあとに回す（route 側の `after`）。
 * - **Strava の通知には署名が無い。** URLを知っていれば誰でも投げられる。
 *   だから、**消す方向の指示は、購読IDが一致した時だけ**通す。
 *   取り込みは、こちらの鍵で Strava に取りに行くだけなので、偽の通知でも害は無い。
 */

import { createHash } from 'node:crypto';
import {
  createPushSubscription,
  deletePushSubscription,
  listPushSubscriptions,
  stravaConfigFromEnv,
  stravaWebhookUrl,
} from './strava';
import { cleanEnv } from './build-info';

/** Strava が合言葉を確かめに来る時のパラメータ名。 */
export const MODE_PARAM = 'hub.mode';
export const TOKEN_PARAM = 'hub.verify_token';
export const CHALLENGE_PARAM = 'hub.challenge';

/**
 * 登録時の合言葉。
 *
 * **環境変数を増やさない。** 設定する項目がひとつ増えるたびに、
 * 本番で「入れ忘れていた」が起きる。鍵から決まる値にしておけば、
 * 登録する時と確かめる時で、必ず同じものになる。
 */
export function webhookVerifyToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const { clientSecret } = stravaConfigFromEnv(env);
  if (!clientSecret) return null;
  return createHash('sha256').update(`runcoach:strava:webhook:${clientSecret}`).digest('hex').slice(0, 32);
}

/**
 * 確認の問い合わせに返す値。合言葉が違えば null。
 * **違う時に何も返さない**ことで、他人のアプリの購読先にされるのを防ぐ。
 */
export function challengeFor(
  params: URLSearchParams,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> | null {
  const expected = webhookVerifyToken(env);
  if (!expected) return null;
  if (params.get(MODE_PARAM) !== 'subscribe') return null;
  if (params.get(TOKEN_PARAM) !== expected) return null;
  const challenge = params.get(CHALLENGE_PARAM);
  if (!challenge) return null;
  return { [CHALLENGE_PARAM]: challenge };
}

export interface StravaEvent {
  objectType: 'activity' | 'athlete';
  aspectType: 'create' | 'update' | 'delete';
  /** 練習のIDか、選手のID。 */
  objectId: number;
  /** 誰の通知か。カルテの athleteId と突き合わせる。 */
  ownerId: number;
  /** どの購読から来たか。**消す方向の指示は、これが一致した時だけ通す。** */
  subscriberId?: number;
  eventTime?: number;
  updates?: Record<string, string>;
}

function numberOf(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  // 文字列で来ることがある。数字として読めるなら受ける。
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

/** 届いた本文を読む。形が違えば null。**知らない形を推測で補わない。** */
export function parseEvent(body: unknown): StravaEvent | null {
  if (!body || typeof body !== 'object') return null;
  const data = body as Record<string, unknown>;

  const objectType = data.object_type;
  if (objectType !== 'activity' && objectType !== 'athlete') return null;

  const aspectType = data.aspect_type;
  if (aspectType !== 'create' && aspectType !== 'update' && aspectType !== 'delete') return null;

  const objectId = numberOf(data.object_id);
  const ownerId = numberOf(data.owner_id);
  if (objectId === undefined || ownerId === undefined) return null;

  const updates =
    data.updates && typeof data.updates === 'object' && !Array.isArray(data.updates)
      ? Object.fromEntries(
          Object.entries(data.updates as Record<string, unknown>).map(([key, value]) => [key, String(value)]),
        )
      : undefined;

  return {
    objectType,
    aspectType,
    objectId,
    ownerId,
    subscriberId: numberOf(data.subscriber_id),
    eventTime: numberOf(data.event_time),
    updates,
  };
}

export type EventAction =
  /** 新しい練習が増えた。取りに行く。 */
  | 'import'
  /** 練習が消された。こちらからも消す。 */
  | 'remove'
  /** 連携を切られた。鍵を捨てる。 */
  | 'disconnect'
  /** 何もしない。**これがいちばん多い。** */
  | 'ignore';

export function actionFor(event: StravaEvent): EventAction {
  if (event.objectType === 'athlete') {
    // 連携を外した時だけ来る。authorized が "false" の時以外は触らない。
    return event.updates?.authorized === 'false' ? 'disconnect' : 'ignore';
  }
  if (event.aspectType === 'create') return 'import';
  if (event.aspectType === 'delete') return 'remove';
  // 名前やタイトルの書き換え。取り込み直す価値はあるが、急がない。
  return event.updates?.title ? 'import' : 'ignore';
}

/** 消す方向の指示か。こちらは、購読IDが一致した時だけ通す。 */
export function isDestructive(action: EventAction): boolean {
  return action === 'remove' || action === 'disconnect';
}

/**
 * いま登録されている購読のID。
 *
 * 通知のたびに問い合わせると、Strava の利用上限を無駄に削る。
 * 変わるものではないので、しばらく覚えておく。
 * **取れなければ undefined。** その時は、消す方向の指示を通さない。
 */
let cached: { id: number | undefined; at: number } | null = null;
const CACHE_MS = 10 * 60_000;

export async function currentSubscriptionId(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch,
  now: Date = new Date(),
): Promise<number | undefined> {
  if (cached && now.getTime() - cached.at < CACHE_MS) return cached.id;
  try {
    const subscriptions = await listPushSubscriptions(env, fetchImpl);
    cached = { id: subscriptions[0]?.id, at: now.getTime() };
  } catch {
    // 問い合わせに失敗しただけ。取り込みは続けてよい。
    cached = { id: undefined, at: now.getTime() };
  }
  return cached.id;
}

/** テスト用。覚えているものを捨てる。 */
export function forgetSubscriptionId(): void {
  cached = null;
}

/**
 * この場所から購読を登録してよいか。
 *
 * **プレビュー用のURLで登録してしまうと、本番の通知がそちらへ流れる。**
 * 購読はアプリにひとつしか持てないので、取り違えると全員分が止まる。
 * だから、本番だと確かめられる場所からしか登録しない。
 */
export function canSubscribe(origin: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!origin.startsWith('https://')) return false;
  const configured = cleanEnv(env.NEXT_PUBLIC_SITE_URL);
  if (configured) return configured.replace(/\/$/, '') === origin.replace(/\/$/, '');
  return cleanEnv(env.VERCEL_ENV) === 'production';
}

export type SubscribeResult =
  /** すでにこのURLで登録されていた。 */
  | 'exists'
  /** いま登録した。 */
  | 'created'
  /** 登録してよい場所ではない（手元・プレビュー）。 */
  | 'skipped'
  /** 別のURLで登録済み。**勝手に付け替えない。** 付け替えは手で。 */
  | 'mismatch'
  /** Strava 側で失敗した。 */
  | 'failed';

/**
 * 購読が無ければ登録する。
 *
 * **設定作業をひとつ減らすための自動化。** 誰かが Strava をつないだ時に、
 * ついでに確かめる。何度呼んでも、登録済みなら何もしない。
 */
export async function ensureSubscription(
  origin: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch,
): Promise<SubscribeResult> {
  const token = webhookVerifyToken(env);
  if (!token) return 'skipped';
  if (!canSubscribe(origin, env)) return 'skipped';

  const callbackUrl = stravaWebhookUrl(origin);
  try {
    const existing = await listPushSubscriptions(env, fetchImpl);
    const mine = existing.find((item) => item.callbackUrl === callbackUrl);
    if (mine) {
      cached = { id: mine.id, at: Date.now() };
      return 'exists';
    }
    if (existing.length > 0) return 'mismatch';

    const created = await createPushSubscription(callbackUrl, token, env, fetchImpl);
    cached = { id: created.id, at: Date.now() };
    return 'created';
  } catch (error) {
    console.error('[coach] strava subscribe failed', error);
    return 'failed';
  }
}

/**
 * いまの購読を、このURLへ付け替える。**手で叩いた時だけ。**
 * 動いているものを消すので、自動では絶対にやらない。
 */
export async function replaceSubscription(
  origin: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch,
): Promise<SubscribeResult> {
  const token = webhookVerifyToken(env);
  if (!token) return 'skipped';

  const callbackUrl = stravaWebhookUrl(origin);
  try {
    for (const item of await listPushSubscriptions(env, fetchImpl)) {
      if (item.callbackUrl === callbackUrl) {
        cached = { id: item.id, at: Date.now() };
        return 'exists';
      }
      await deletePushSubscription(item.id, env, fetchImpl);
    }
    const created = await createPushSubscription(callbackUrl, token, env, fetchImpl);
    cached = { id: created.id, at: Date.now() };
    return 'created';
  } catch (error) {
    console.error('[coach] strava resubscribe failed', error);
    return 'failed';
  }
}
