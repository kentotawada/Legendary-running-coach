import { createSupabaseServerClient } from '@/lib/supabase';
import { siteOrigin } from '@/lib/site-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Google のログイン画面へ送る。 */
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const origin = siteOrigin(request);
  if (!supabase) return Response.redirect(`${origin}/?auth=unconfigured`, 302);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${origin}/api/auth/callback` },
  });

  if (error || !data.url) {
    console.error('[auth] Google ログインの開始に失敗', error?.message);
    return Response.redirect(`${origin}/?auth=failed`, 302);
  }

  return Response.redirect(data.url, 302);
}
