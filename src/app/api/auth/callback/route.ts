import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase';
import { siteOrigin } from '@/lib/site-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ログインリンク / Google から戻ってくる場所。
 * 受け取った code をセッションに交換して、アプリへ戻す。
 *
 * 素の Response.redirect ではなく NextResponse.redirect を使うのは、
 * cookies() で書いたセッションクッキーを応答に必ず載せるため。
 * ここを間違えると、交換自体は成功しているのにログインが成立しない。
 */
export async function GET(request: Request) {
  const origin = siteOrigin(request);
  const code = new URL(request.url).searchParams.get('code');
  if (!code) return NextResponse.redirect(`${origin}/?auth=failed`);

  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.redirect(`${origin}/?auth=unconfigured`);

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error('[auth] セッションへの交換に失敗', error.message);
    return NextResponse.redirect(`${origin}/?auth=failed`);
  }

  return NextResponse.redirect(`${origin}/?auth=signed-in`);
}
