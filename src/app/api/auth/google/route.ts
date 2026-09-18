import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase';
import { siteOrigin } from '@/lib/site-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Google のログイン画面へ送る。
 *
 * この時 Supabase は PKCE の検証用コードをクッキーに書く。
 * 素の Response.redirect だとそれが応答に載らず、
 * 戻ってきた時の交換に失敗するため NextResponse.redirect を使う。
 */
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const origin = siteOrigin(request);
  if (!supabase) return NextResponse.redirect(`${origin}/?auth=unconfigured`);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${origin}/api/auth/callback` },
  });

  if (error || !data.url) {
    console.error('[auth] Google ログインの開始に失敗', error?.message);
    return NextResponse.redirect(`${origin}/?auth=failed`);
  }

  return NextResponse.redirect(data.url);
}
