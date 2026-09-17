import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from './supabase';

export const USER_COOKIE = 'rc_uid';

/** 匿名IDの形。自分で発行した UUID だけを受け付ける。 */
const ANONYMOUS_ID = /^[a-zA-Z0-9-]{8,64}$/;

export interface CoachSession {
  /** 保存層のキー。ログイン済みなら Supabase のユーザーID、未ログインなら匿名ID。 */
  userId: string;
  /** 匿名IDを新しく発行したか（Cookie を返す必要があるか）。 */
  isNew: boolean;
  /** 未ログイン時に使っていた匿名ID。ログイン後の引き継ぎに使う。 */
  anonymousId?: string;
  authUserId?: string;
  email?: string;
  isAuthenticated: boolean;
}

/**
 * このリクエストが誰のものかを決める。
 *
 * ログインを必須にしていないのは、最初の一言を交わす前に
 * メールアドレスを求めると、ほとんどの人がそこで離脱するため。
 * 未ログインでも使えて、ログインした時に記録が引き継がれる形にしている。
 */
export async function resolveUserId(request: NextRequest): Promise<CoachSession> {
  const cookie = request.cookies.get(USER_COOKIE)?.value;
  const anonymousId = cookie && ANONYMOUS_ID.test(cookie) ? cookie : undefined;

  const supabase = await createSupabaseServerClient();
  if (supabase) {
    // getSession ではなく getUser を使う。Cookie の中身を信用せず、
    // 認証サーバーでトークンを検証するため。
    const { data, error } = await supabase.auth.getUser();
    if (!error && data.user) {
      return {
        userId: data.user.id,
        isNew: false,
        anonymousId,
        authUserId: data.user.id,
        email: data.user.email ?? undefined,
        isAuthenticated: true,
      };
    }
  }

  const userId = anonymousId ?? globalThis.crypto.randomUUID();
  return { userId, isNew: !anonymousId, anonymousId: userId, isAuthenticated: false };
}

export function userCookieHeader(userId: string): string {
  const oneYear = 60 * 60 * 24 * 365;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${USER_COOKIE}=${userId}; Path=/; Max-Age=${oneYear}; HttpOnly; SameSite=Lax${secure}`;
}
