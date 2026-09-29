import type { NextRequest } from 'next/server';
import { billingConfigFromEnv } from '@/lib/billing';
import { stripeClient } from '@/lib/stripe';
import { resolveUserId } from '@/lib/session';
import { loadForSession } from '@/lib/store';
import { siteOrigin } from '@/lib/site-url';
import { reportError } from '@/lib/ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 解約・カードの変更・領収書。**全部 Stripe の画面に任せる。**
 *
 * 自前で作らないのは、解約の導線を自分の手で細くしないため。
 * 「辞めにくいアプリ」は、そのぶん最初に入ってもらえなくなる。
 */
export async function POST(request: NextRequest) {
  const config = billingConfigFromEnv();
  if (!config) {
    return Response.json({ error: '有料プランはまだ準備中です。' }, { status: 503 });
  }

  const session = await resolveUserId(request);
  if (!session.isAuthenticated) {
    return Response.json({ error: 'ログインしてください。' }, { status: 401 });
  }

  let customerId: string | undefined;
  try {
    const state = await loadForSession(session);
    customerId = state.profile.subscription?.customerId;
  } catch (error) {
    await reportError('billing:portal:load', error, { userId: session.userId });
    return Response.json({ error: '記録を読み込めませんでした。' }, { status: 503 });
  }

  if (!customerId) {
    return Response.json({ error: 'ご契約が見つかりませんでした。' }, { status: 404 });
  }

  try {
    const portal = await stripeClient(config).billingPortal.sessions.create({
      customer: customerId,
      return_url: `${siteOrigin(request)}/`,
    });
    return Response.json({ url: portal.url });
  } catch (error) {
    await reportError('billing:portal', error, { userId: session.userId });
    return Response.json({ error: '契約の画面を開けませんでした。' }, { status: 502 });
  }
}
