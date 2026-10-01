import type { NextRequest } from 'next/server';
import { cleanEnv } from '@/lib/build-info';
import { siteOrigin } from '@/lib/site-url';
import { isStravaConfigured, listPushSubscriptions, stravaWebhookUrl } from '@/lib/strava';
import { replaceSubscription } from '@/lib/strava-webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 練習の到着を受け取る購読を、見る・付け替える口。
 *
 * ふだんは Strava をつないだ時に自動で登録されるので、ここを叩く用事は無い。
 * 使うのは、**自動登録が「別のURLで登録済み」で止まった時**だけ。
 * （プレビュー用のURLで登録されてしまった時など。）
 *
 * **CRON_SECRET が無い環境では動かさない。** 誰でも叩ける口にすると、
 * 購読を他所へ付け替えられてしまい、全員分の自動取り込みが止まる。
 */
function authorized(request: NextRequest): boolean {
  const secret = cleanEnv(process.env.CRON_SECRET);
  if (!secret) return false;
  return (request.headers.get('authorization') ?? '') === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return Response.json({ error: 'この操作は許可されていません。' }, { status: 401 });
  }
  if (!isStravaConfigured()) {
    return Response.json({ error: 'Strava の鍵が設定されていません。' }, { status: 503 });
  }

  const callbackUrl = stravaWebhookUrl(siteOrigin(request));
  try {
    const subscriptions = await listPushSubscriptions();
    return Response.json({
      callbackUrl,
      subscriptions,
      // true なら、走り終えた記録がこの場所へ届く。
      matches: subscriptions.some((item) => item.callbackUrl === callbackUrl),
    });
  } catch (error) {
    return Response.json(
      { error: 'Strava に問い合わせできませんでした。', detail: String(error) },
      { status: 502 },
    );
  }
}

/** いまの購読を、この場所へ付け替える。**動いているものを消すので、手で叩いた時だけ。** */
export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return Response.json({ error: 'この操作は許可されていません。' }, { status: 401 });
  }
  if (!isStravaConfigured()) {
    return Response.json({ error: 'Strava の鍵が設定されていません。' }, { status: 503 });
  }

  const origin = siteOrigin(request);
  const result = await replaceSubscription(origin);
  return Response.json(
    { result, callbackUrl: stravaWebhookUrl(origin) },
    { status: result === 'failed' ? 502 : 200 },
  );
}
