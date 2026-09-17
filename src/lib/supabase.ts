import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { cleanEnv } from './build-info';

/**
 * Supabase の設定。
 *
 * キーの呼び名は Supabase 側で変わってきている（anon/service_role → publishable/secret）ため、
 * どちらの名前でも受け取れるようにしている。
 */
export interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceKey?: string;
}

export function supabaseConfig(env: NodeJS.ProcessEnv = process.env): SupabaseConfig | null {
  const url = cleanEnv(env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey =
    cleanEnv(env.NEXT_PUBLIC_SUPABASE_ANON_KEY) || cleanEnv(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const serviceKey = cleanEnv(env.SUPABASE_SERVICE_ROLE_KEY) || cleanEnv(env.SUPABASE_SECRET_KEY);

  if (!url || !anonKey) return null;
  return { url, anonKey, serviceKey: serviceKey || undefined };
}

export function isSupabaseConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return supabaseConfig(env) !== null;
}

/**
 * ログイン状態を読むためのクライアント。Cookie を通じてセッションを扱う。
 * Server Component からは Cookie を書けないため、書き込み失敗は握りつぶす
 * （その場合はミドルウェアやルートハンドラ側で更新される）。
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient | null> {
  const config = supabaseConfig();
  if (!config) return null;

  const cookieStore = await cookies();

  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component から呼ばれた場合。ここでは何もしない。
        }
      },
    },
  });
}

/**
 * データ読み書き用のクライアント。service_role キーを使うため RLS を迂回する。
 * **サーバー側でのみ使うこと。** このキーがブラウザへ渡ると、全ユーザーのデータが読めてしまう。
 */
export function createSupabaseAdminClient(): SupabaseClient | null {
  const config = supabaseConfig();
  if (!config?.serviceKey) return null;

  return createClient(config.url, config.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
