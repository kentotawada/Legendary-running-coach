import type { NextRequest } from 'next/server';

export const USER_COOKIE = 'rc_uid';

/** 端末ごとの識別子。ログイン機構を入れるまでの繋ぎで、ここだけ差し替えれば済むようにしている。 */
export function resolveUserId(request: NextRequest): { userId: string; isNew: boolean } {
  const existing = request.cookies.get(USER_COOKIE)?.value;
  if (existing && /^[a-zA-Z0-9-]{8,64}$/.test(existing)) {
    return { userId: existing, isNew: false };
  }
  return { userId: globalThis.crypto.randomUUID(), isNew: true };
}

export function userCookieHeader(userId: string): string {
  const oneYear = 60 * 60 * 24 * 365;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${USER_COOKIE}=${userId}; Path=/; Max-Age=${oneYear}; HttpOnly; SameSite=Lax${secure}`;
}
