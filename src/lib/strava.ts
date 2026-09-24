/**
 * Strava との接続。
 *
 * ランニングアプリ側にはもう記録があります。
 * それをスクリーンショットに撮って送ってもらうのは、本来いらない手間です。
 * つないでおけば、走り終えた時点で記録が入っていて、開いたらもう評価がある——
 * この状態が、汎用のチャットでは絶対に作れないものです。
 *
 * Garmin の公式APIは個人開発者には開かれていませんが、
 * Garmin を使っている人のほとんどは Strava へ自動連携しているので、
 * ここを押さえれば実質的に届きます。
 *
 * **鍵（STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET）が無い環境では、接続そのものを出しません。**
 */

import { cleanEnv } from './build-info';
import { formatPace } from './goals';
import type { ActivityLog, ShoeRole } from './types';

const AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';
const TOKEN_URL = 'https://www.strava.com/oauth/token';
const DEAUTHORIZE_URL = 'https://www.strava.com/oauth/deauthorize';
const API = 'https://www.strava.com/api/v3';

/** 練習の記録を読むための権限。非公開の練習まで含めないと、見えない日ができる。 */
export const STRAVA_SCOPE = 'activity:read_all';

/** 初回に遡って取り込む日数。長すぎると往復が増え、短いと「何も入らない」と感じる。 */
export const FIRST_SYNC_DAYS = 90;

/** 1回の同期で取りに行く上限。 */
export const MAX_PAGES = 3;
export const PER_PAGE = 50;

/** 期限切れの直前に更新する余裕（秒）。 */
const REFRESH_MARGIN_SEC = 120;

const TIMEOUT_MS = 10_000;

export interface StravaConfig {
  clientId?: string;
  clientSecret?: string;
}

export function stravaConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StravaConfig {
  return {
    clientId: cleanEnv(env.STRAVA_CLIENT_ID) || undefined,
    clientSecret: cleanEnv(env.STRAVA_CLIENT_SECRET) || undefined,
  };
}

export function isStravaConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const config = stravaConfigFromEnv(env);
  return Boolean(config.clientId && config.clientSecret);
}

export function stravaRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, '')}/api/strava/callback`;
}

/** 認可画面のURL。state は付け替え防止のため呼び出し側が発行する。 */
export function authorizeUrl(origin: string, state: string, env: NodeJS.ProcessEnv = process.env): string {
  const { clientId } = stravaConfigFromEnv(env);
  const params = new URLSearchParams({
    client_id: clientId ?? '',
    redirect_uri: stravaRedirectUri(origin),
    response_type: 'code',
    approval_prompt: 'auto',
    scope: STRAVA_SCOPE,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface StravaTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  athleteId?: number;
  athleteName?: string;
}

export class StravaError extends Error {
  constructor(
    message: string,
    readonly detail: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'StravaError';
  }
}

type Fetcher = typeof fetch;

async function call(
  fetchImpl: Fetcher,
  url: string,
  init: RequestInit & { what: string },
): Promise<unknown> {
  const { what, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { ...rest, signal: controller.signal });
    const body = await response.text();
    if (!response.ok) {
      // 429（上限）と 401（期限切れ・権限取り消し）は意味が違う。状態番号を残す。
      throw new StravaError(
        response.status === 429
          ? 'Strava の利用上限に達しました。15分ほどおいてから、もう一度同期してください。'
          : response.status === 401
            ? 'Strava の接続が切れています。カルテからつなぎ直してください。'
            : 'Strava との通信に失敗しました。',
        `${response.status} ${body.slice(0, 300)}`,
        response.status,
      );
    }
    return body ? (JSON.parse(body) as unknown) : null;
  } catch (error) {
    if (error instanceof StravaError) throw error;
    throw new StravaError(
      'Strava との通信に失敗しました。',
      error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    );
  } finally {
    clearTimeout(timer);
  }
}

function tokensFrom(json: unknown): StravaTokens {
  const data = (json ?? {}) as Record<string, unknown>;
  const athlete = (data.athlete ?? {}) as Record<string, unknown>;
  const accessToken = typeof data.access_token === 'string' ? data.access_token : '';
  const refreshToken = typeof data.refresh_token === 'string' ? data.refresh_token : '';
  if (!accessToken || !refreshToken) {
    throw new StravaError('Strava から鍵を受け取れませんでした。', JSON.stringify(data).slice(0, 200));
  }
  const name = [athlete.firstname, athlete.lastname].filter((part) => typeof part === 'string').join(' ').trim();
  return {
    accessToken,
    refreshToken,
    expiresAt: typeof data.expires_at === 'number' ? data.expires_at : 0,
    athleteId: typeof athlete.id === 'number' ? athlete.id : undefined,
    athleteName: name || undefined,
  };
}

export async function exchangeCode(
  code: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: Fetcher = (...args) => fetch(...args),
): Promise<StravaTokens> {
  const { clientId, clientSecret } = stravaConfigFromEnv(env);
  const json = await call(fetchImpl, TOKEN_URL, {
    what: 'token',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  });
  return tokensFrom(json);
}

export async function refreshTokens(
  refreshToken: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: Fetcher = (...args) => fetch(...args),
): Promise<StravaTokens> {
  const { clientId, clientSecret } = stravaConfigFromEnv(env);
  const json = await call(fetchImpl, TOKEN_URL, {
    what: 'refresh',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  return tokensFrom(json);
}

export function needsRefresh(expiresAt: number, now: Date = new Date()): boolean {
  return expiresAt - REFRESH_MARGIN_SEC <= Math.floor(now.getTime() / 1000);
}

export async function deauthorize(
  accessToken: string,
  fetchImpl: Fetcher = (...args) => fetch(...args),
): Promise<void> {
  try {
    await call(fetchImpl, DEAUTHORIZE_URL, {
      what: 'deauthorize',
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // 向こうで切れていても、こちらの接続は消す。ここで止める理由はない。
  }
}

/**
 * Strava の入口。
 *
 * **設定ページの深いURLは案内に使わない。**
 * あの手のページは認証が要るので、ログインしていない人には
 * ログイン画面しか出ない。「まずここを押す」と書いてあるものが
 * ログインを求めてくるのは、いちばん諦めやすい形になる。
 *
 * ここは入口だけを指し、道順は手順の文章で示す。
 * スマホでアプリが入っていれば、このリンクはアプリ側が開く。
 */
export const STRAVA_URL = 'https://www.strava.com/';

export interface StravaActivity {
  id: number;
  name?: string;
  type?: string;
  sport_type?: string;
  start_date_local?: string;
  distance?: number;
  moving_time?: number;
  elapsed_time?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  total_elevation_gain?: number;
  gear_id?: string | null;
  /** 取り込み元の識別子。Garmin からの自動連携だと "garmin_push_..." の形で入る。 */
  external_id?: string | null;
  /** 詳細を取った時だけ入る。一覧には無いことが多い。 */
  device_name?: string | null;
}

/**
 * Garmin から自動で流れてきた記録か。
 *
 * **確実な判定ではない。** 一覧に識別子が入らない場合もあるので、
 * 「Garmin が見つからない＝連携できていない」とは言い切らないこと。
 * 見つかった時にだけ「確認できました」と言うために使う。
 */
export function isFromGarmin(activity: StravaActivity): boolean {
  const source = `${activity.external_id ?? ''} ${activity.device_name ?? ''}`.toLowerCase();
  return source.includes('garmin');
}

/** after（UNIX秒）以降の練習を、新しい順ではなく古い順に集める。 */
export async function fetchActivities(
  accessToken: string,
  after: number,
  fetchImpl: Fetcher = (...args) => fetch(...args),
): Promise<StravaActivity[]> {
  const all: StravaActivity[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      after: String(Math.max(0, Math.floor(after))),
      page: String(page),
      per_page: String(PER_PAGE),
    });
    const json = await call(fetchImpl, `${API}/athlete/activities?${params.toString()}`, {
      what: 'activities',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    const items = Array.isArray(json) ? (json as StravaActivity[]) : [];
    all.push(...items.filter((item) => item && typeof item.id === 'number'));
    if (items.length < PER_PAGE) break;
  }
  // 古い順に積む。シューズの距離も、この順で増えていく方が自然。
  return all.sort((a, b) => (a.start_date_local ?? '').localeCompare(b.start_date_local ?? ''));
}

export interface StravaGear {
  id: string;
  name?: string;
  /** 累計距離(m)。**この値が正**として扱う。 */
  distance?: number;
  retired?: boolean;
}

export async function fetchGear(
  accessToken: string,
  gearId: string,
  fetchImpl: Fetcher = (...args) => fetch(...args),
): Promise<StravaGear | null> {
  try {
    const json = await call(fetchImpl, `${API}/gear/${encodeURIComponent(gearId)}`, {
      what: 'gear',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    const data = (json ?? {}) as Record<string, unknown>;
    return {
      id: gearId,
      name: typeof data.name === 'string' ? data.name : undefined,
      distance: typeof data.distance === 'number' ? data.distance : undefined,
      retired: data.retired === true,
    };
  } catch {
    // 靴の情報が取れなくても、練習の取り込みは続ける。
    return null;
  }
}

/** Strava の種目を、こちらの区分に寄せる。分からないものは取り込まない。 */
export function activityTypeOf(activity: StravaActivity): ActivityLog['type'] | null {
  const sport = `${activity.sport_type ?? activity.type ?? ''}`;
  if (/^(Run|TrailRun|VirtualRun|Treadmill)/i.test(sport)) return 'run';
  if (/^(Walk|Hike)/i.test(sport)) return 'walk';
  if (/^(Ride|VirtualRide|EBikeRide|Swim|Elliptical|Rowing|NordicSki|Snowshoe|StairStepper)/i.test(sport)) {
    return 'cross';
  }
  if (/^(WeightTraining|Workout|Crossfit)/i.test(sport)) return 'strength';
  if (/^(Yoga|Pilates)/i.test(sport)) return 'stretch';
  return null;
}

/**
 * Strava が自動で付ける名前かどうか。
 * 「Morning Run」のままなら練習の種別ではないので、そのまま持ち込まない。
 * 本人が「閾値走 20分」と書き換えていれば、それは意味のある情報。
 */
export function isDefaultName(name: string | undefined): boolean {
  if (!name) return true;
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (/^(Morning|Afternoon|Evening|Lunch|Night|Late Night)\s+\w+/i.test(trimmed)) return true;
  if (/^(午前|午後|朝|昼|夕方|夜|深夜)の?(ラン|ランニング|ウォーク|ウォーキング|アクティビティ|ライド|サイクリング|水泳)/.test(trimmed)) {
    return true;
  }
  return false;
}

/** ランでは1歩ではなく片脚の回転数が返る。ピッチ（spm）にするには2倍。 */
export function cadenceToSpm(average?: number): number | undefined {
  if (typeof average !== 'number' || !Number.isFinite(average) || average <= 0) return undefined;
  return Math.round(average * 2);
}

/**
 * Strava の1件を、こちらの練習記録に直す。
 * 取り込まない種目、距離も時間も無い記録は null。
 */
export function toActivityLog(
  activity: StravaActivity,
): Omit<ActivityLog, 'id' | 'createdAt'> | null {
  const type = activityTypeOf(activity);
  if (!type) return null;

  const date = (activity.start_date_local ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const meters = typeof activity.distance === 'number' ? activity.distance : 0;
  const seconds = typeof activity.moving_time === 'number' ? activity.moving_time : 0;
  const distanceKm = meters > 0 ? Math.round((meters / 1000) * 100) / 100 : undefined;
  const durationMin = seconds > 0 ? Math.round(seconds / 60) : undefined;
  if (distanceKm === undefined && durationMin === undefined) return null;

  const onFoot = type === 'run' || type === 'walk';
  const spm = onFoot ? cadenceToSpm(activity.average_cadence) : undefined;
  const avgPace =
    onFoot && meters > 0 && seconds > 0 ? formatPace(seconds / (meters / 1000)) : undefined;
  // ストライド = 1分あたりの進む距離 ÷ ピッチ。
  const strideM =
    spm && meters > 0 && seconds > 0
      ? Math.round((meters / (seconds / 60) / spm) * 100) / 100
      : undefined;

  const metrics = {
    avgPace,
    avgHr: typeof activity.average_heartrate === 'number' ? Math.round(activity.average_heartrate) : undefined,
    maxHr: typeof activity.max_heartrate === 'number' ? Math.round(activity.max_heartrate) : undefined,
    cadence: spm,
    strideM,
    elevationGainM:
      typeof activity.total_elevation_gain === 'number'
        ? Math.round(activity.total_elevation_gain)
        : undefined,
  };
  const hasMetrics = Object.values(metrics).some((value) => value !== undefined);

  return {
    date,
    type,
    session: isDefaultName(activity.name) ? undefined : activity.name?.trim(),
    distanceKm,
    durationMin,
    metrics: hasMetrics ? metrics : undefined,
    source: 'strava',
    externalId: `strava:${activity.id}`,
  };
}

/** 靴の名前から用途を推し量る。外れても、本人が言い直せばそちらが優先される。 */
export function shoeRoleOf(name: string | undefined): ShoeRole {
  if (!name) return 'daily';
  return /alphafly|vaporfly|adizero adios pro|metaspeed|endorphin (pro|elite)|レース|carbon|カーボン/i.test(name)
    ? 'race'
    : 'daily';
}
