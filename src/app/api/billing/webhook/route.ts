import type { NextRequest } from 'next/server';
import type Stripe from 'stripe';
import { billingConfigFromEnv, normalizeStatus } from '@/lib/billing';
import { stripeClient } from '@/lib/stripe';
import { getStore } from '@/lib/store';
import { countEvent, counterOf, reportError } from '@/lib/ops';
import type { Subscription } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Stripe からの知らせ。**ここが、お金と枠をつなぐ唯一の場所。**
 *
 * 画面の戻り先（success_url）では枠を開けない。戻ってこない人もいれば、
 * URL を直接叩く人もいる。**払ったかどうかを知っているのは Stripe だけ**なので、
 * Stripe からの知らせだけを信じる。
 *
 * 署名を必ず確かめる。確かめなければ、この口を叩くだけで誰でも有料になれる。
 */
export async function POST(request: NextRequest) {
  const config = billingConfigFromEnv();
  if (!config) return Response.json({ error: 'not configured' }, { status: 503 });

  const signature = request.headers.get('stripe-signature');
  if (!signature) return Response.json({ error: 'missing signature' }, { status: 400 });

  // 署名は生の本文に対して作られている。JSON に直す前に読む。
  const raw = await request.text();

  let event: Stripe.Event;
  try {
    event = await stripeClient(config).webhooks.constructEventAsync(
      raw,
      signature,
      config.webhookSecret,
    );
  } catch (error) {
    // **ここで通してはいけない。** 誰の知らせか分からないものを信じない。
    await reportError('billing:webhook:signature', error, {});
    return Response.json({ error: 'invalid signature' }, { status: 400 });
  }

  try {
    await handle(event, config.priceId);
  } catch (error) {
    await reportError('billing:webhook', error, { kind: event.type });
    // 5xx を返すと Stripe が送り直してくれる。取りこぼすより、二度来るほうがよい。
    return Response.json({ error: 'failed' }, { status: 500 });
  }

  return Response.json({ received: true });
}

/** 契約の中身を、こちらが持つ形に畳む。 */
function toSubscription(subscription: Stripe.Subscription, customerId: string): Subscription {
  const item = subscription.items?.data?.[0];
  const periodEnd = item?.current_period_end;
  return {
    customerId,
    subscriptionId: subscription.id,
    status: normalizeStatus(subscription.status),
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : undefined,
    cancelAtPeriodEnd: subscription.cancel_at_period_end || undefined,
    updatedAt: new Date().toISOString(),
  };
}

function idOf(value: string | { id: string } | null | undefined): string | undefined {
  if (!value) return undefined;
  return typeof value === 'string' ? value : value.id;
}

/**
 * どの利用者の契約か。
 *
 * **metadata に自分で入れた印だけを見る。** メールアドレスで突き合わせると、
 * Stripe 側で変えられた時に別人の枠を開けてしまう。
 */
function userIdOf(subscription: Stripe.Subscription): string | undefined {
  const raw = subscription.metadata?.userId;
  return typeof raw === 'string' && raw ? raw : undefined;
}

async function handle(event: Stripe.Event, priceId: string): Promise<void> {
  const store = getStore();

  switch (event.type) {
    case 'checkout.session.completed': {
      const checkout = event.data.object;
      const userId = checkout.client_reference_id ?? checkout.metadata?.userId;
      const customerId = idOf(checkout.customer);
      const subscriptionId = idOf(checkout.subscription);
      if (!userId || !customerId || !subscriptionId) return;

      // 画面から返る値は最小限なので、契約の中身は Stripe に聞き直す。
      const config = billingConfigFromEnv();
      if (!config) return;
      const subscription = await stripeClient(config).subscriptions.retrieve(subscriptionId);
      await write(store, userId, toSubscription(subscription, customerId));
      await countEvent(counterOf(store), 'subscribe');
      return;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const userId = userIdOf(subscription);
      const customerId = idOf(subscription.customer);
      if (!userId || !customerId) return;

      // 他の商品を売り始めた時に、別の契約でこちらの枠を開けない。
      const soldHere = subscription.items?.data?.some((item) => item.price?.id === priceId);
      if (soldHere === false) return;

      const next = toSubscription(subscription, customerId);
      // 削除の知らせは、状態が何であれ終わりとして扱う。
      if (event.type === 'customer.subscription.deleted') next.status = 'canceled';
      await write(store, userId, next);
      if (next.status === 'canceled') await countEvent(counterOf(store), 'unsubscribe');
      return;
    }

    default:
      return;
  }
}

/**
 * カルテに書き戻す。**会話の履歴は読まない。**
 * 知らせは対話と関係なく飛んでくるので、重いものを触らない。
 */
async function write(
  store: ReturnType<typeof getStore>,
  userId: string,
  subscription: Subscription,
): Promise<void> {
  if (!store.saveProfile) {
    throw new Error('この保存層はカルテだけの書き戻しに対応していません');
  }
  const state = await store.load(userId);
  await store.saveProfile(userId, { ...state.profile, subscription });
}
