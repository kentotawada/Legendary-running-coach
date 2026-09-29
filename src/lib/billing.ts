/**
 * 有料の枠。
 *
 * **カード番号はこのサーバーを一度も通らない。** 決済の画面は Stripe 側に置き、
 * こちらは「誰が、いまどの状態か」だけを受け取って持つ。預からなければ、
 * 漏らしようがない。プライバシーポリシーにもそう書ける。
 *
 * **値段はコードに書かない。** Stripe の管理画面で作った価格を id で指すだけにして、
 * 金額を変えるのにデプロイが要らないようにしてある。単価と同じ考え方で、
 * 動くものをコードに焼き付けない。
 */

import { cleanEnv } from './env';
import type { RunnerProfile, Subscription } from './types';

export interface BillingConfig {
  secretKey: string;
  priceId: string;
  webhookSecret: string;
}

/** 設定がそろっていなければ null。**そろわないうちは、入口ごと出さない。** */
export function billingConfigFromEnv(env: NodeJS.ProcessEnv = process.env): BillingConfig | null {
  const secretKey = cleanEnv(env.STRIPE_SECRET_KEY);
  const priceId = cleanEnv(env.STRIPE_PRICE_ID);
  const webhookSecret = cleanEnv(env.STRIPE_WEBHOOK_SECRET);
  if (!secretKey || !priceId || !webhookSecret) return null;
  return { secretKey, priceId, webhookSecret };
}

export function isBillingConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return billingConfigFromEnv(env) !== null;
}

/**
 * いま有料の枠として扱ってよいか。
 *
 * **解約した人を、期間の途中で締め出さない。** 解約を押した時点では
 * status が canceled にならず、期間の終わりまで active のまま来る。
 * それでも念のため、期限を過ぎていたら無効として扱う。
 * 期限が分からない（古い記録）時は、status を信じる。
 */
export function isSubscriptionActive(
  subscription: Subscription | undefined,
  now: Date = new Date(),
): boolean {
  if (!subscription) return false;
  if (subscription.status !== 'active' && subscription.status !== 'trialing') return false;
  if (!subscription.currentPeriodEnd) return true;
  const end = new Date(subscription.currentPeriodEnd);
  if (Number.isNaN(end.getTime())) return true;
  return end.getTime() > now.getTime();
}

/** Stripe から来た status を、こちらが扱う4つに畳む。知らない値は無効側に倒す。 */
export function normalizeStatus(raw: string): Subscription['status'] {
  switch (raw) {
    case 'active':
    case 'trialing':
    case 'past_due':
      return raw;
    default:
      return 'canceled';
  }
}

/**
 * Stripe から届いた内容を、カルテに畳み込む。
 *
 * **こちらが持つのは状態だけ。** 金額も明細も持たない。持てば、
 * 食い違った時にどちらが正しいのか分からなくなる。正は常に Stripe。
 */
export function applySubscription(profile: RunnerProfile, next: Subscription): RunnerProfile {
  return { ...profile, subscription: next };
}

/** 契約中の人が、自分の契約を触れる状態か（解約・カード変更の入口を出すか）。 */
export function canManageBilling(profile: RunnerProfile): boolean {
  return Boolean(profile.subscription?.customerId);
}
