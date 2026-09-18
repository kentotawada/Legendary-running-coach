import { createSupabaseServerClient } from '@/lib/supabase';
import { siteOrigin } from '@/lib/site-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** メールアドレスにログイン用リンクを送る。 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return Response.json({ error: 'ログイン機能が設定されていません。' }, { status: 503 });
  }

  let body: { email?: unknown };
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return Response.json({ error: 'リクエストの形式が正しくありません。' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: 'メールアドレスの形式を確認してください。' }, { status: 400 });
  }

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${siteOrigin(request)}/api/auth/callback` },
  });

  if (error) {
    console.error('[auth] マジックリンクの送信に失敗', error.message);
    return Response.json(
      { error: 'ログインリンクを送れませんでした。少し時間をおいて試してください。' },
      { status: 502 },
    );
  }

  return Response.json({ ok: true });
}
