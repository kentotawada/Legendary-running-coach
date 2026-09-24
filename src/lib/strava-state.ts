/**
 * Strava の認可で使う state の受け渡し。
 *
 * 認可へ送り出す時に発行し、戻ってきた時に Cookie と突き合わせます。
 * これが無いと、他人が用意したリンクを踏まされて、
 * 意図しないアカウントにつながる（CSRF）余地が残ります。
 */

export const STRAVA_STATE_COOKIE = 'rc_strava_state';

/** 認可画面を往復する数分だけ持てばよい。 */
const MAX_AGE_SEC = 600;

export function newStateToken(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, '');
}

export function stateCookieHeader(state: string): string {
  return [
    `${STRAVA_STATE_COOKIE}=${state}`,
    'Path=/',
    `Max-Age=${MAX_AGE_SEC}`,
    'HttpOnly',
    'SameSite=Lax',
    'Secure',
  ].join('; ');
}

/** 使い終わったら消す。残しておく理由がない。 */
export function clearStateCookieHeader(): string {
  return `${STRAVA_STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`;
}

/** 期待した state と一致するか。どちらかが欠けていれば不一致として扱う。 */
export function stateMatches(cookie: string | undefined, received: string | null): boolean {
  if (!cookie || !received) return false;
  return cookie === received;
}
