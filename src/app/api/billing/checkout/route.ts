import type { NextRequest } from 'next/server';
import { billingConfigFromEnv } from '@/lib/billing';
import { commerceInfo } from '@/lib/legal';
import { stripeClient } from '@/lib/stripe';
import { resolveUserId } from '@/lib/session';
import { siteOrigin } from '@/lib/site-url';
import { reportError } from '@/lib/ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 支払いの画面へ送り出す。
 *
 * **ログインしていない人には出さない。** 匿名のまま契約させると、
 * Cookie を失った時点で、払ったことを証明する手立てが本人に残らない。
 *
 * カード番号はここを通らない。返すのは Stripe が用意した画面のURLだけ。
 */
export async function POST(request: NextRequest) {
  const config = billingConfigFromEnv();
  if (!config) {
    return Response.json({ error: '有料プランはまだ準備中です。' }, { status: 503 });
  }

  /*
    **表記が埋まるまで、お金を受け取らない。**
    特定商取引法に基づく表記は、有料にするなら任意ではない。
    設定を忘れたまま課金が始まる状態を、コードの側で作らない。
  */
  if (commerceInfo().incomplete) {
    return Response.json({ error: '有料プランはまだ準備中です。' }, { status: 503 });
  }

  const session = await resolveUserId(request);
  if (!session.isAuthenticated || !session.authUserId) {
    return Response.json(
      { error: 'ログインしてからお申し込みください。記録を引き継ぐために必要です。' },
      { status: 401 },
    );
  }

  const origin = siteOrigin(request);
  try {
    const checkout = await stripeClient(config).checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: config.priceId, quantity: 1 }],
      // 戻ってきた時に、誰の契約かを突き合わせるための印。
      client_reference_id: session.authUserId,
      customer_email: session.email,
      subscription_data: { metadata: { userId: session.authUserId } },
      metadata: { userId: session.authUserId },
      success_url: `${origin}/?billing=done`,
      cancel_url: `${origin}/?billing=canceled`,
      allow_promotion_codes: true,
    });

    if (!checkout.url) throw new Error('Stripe から画面のURLが返りませんでした');
    return Response.json({ url: checkout.url });
  } catch (error) {
    await reportError('billing:checkout', error, { userId: session.userId });
    return Response.json(
      { error: '支払いの画面を開けませんでした。少し時間をおいて、もう一度お試しください。' },
      { status: 502 },
    );
  }
}
