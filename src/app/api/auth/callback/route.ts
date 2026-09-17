import { createSupabaseServerClient } from '@/lib/supabase';
import { siteOrigin } from '@/lib/site-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ログインリンク / Google から戻ってくる場所。
 * 受け取った code をセッションに交換して、アプリへ戻す。
 */
export async function GET(request: Request) {
  const origin = siteOrigin(request);
  const code = new URL(request.url).searchParams.get('code');
  if (!code) return Response.redirect(`${origin}/?auth=failed`, 302);

  const supabase = await createSupabaseServerClient();
  if (!supabase) return Response.redirect(`${origin}/?auth=unconfigured`, 302);

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error('[auth] セッションへの交換に失敗', error.message);
    return Response.redirect(`${origin}/?auth=failed`, 302);
  }

  return Response.redirect(`${origin}/?auth=signed-in`, 302);
}
