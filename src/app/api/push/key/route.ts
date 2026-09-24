import { vapidFromEnv } from '@/lib/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 購読に必要な公開鍵。
 * 秘密鍵はサーバーから出さない（出したら、誰でもこのアプリの名前で通知を送れる）。
 */
export async function GET() {
  const vapid = vapidFromEnv();
  if (!vapid) return Response.json({ available: false }, { status: 200 });
  return Response.json({ available: true, publicKey: vapid.publicKey });
}
