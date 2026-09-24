/**
 * プッシュ通知の送信口。
 *
 * **鍵（VAPID）が無い環境では、通知の項目そのものを画面に出しません。**
 *
 * iOS では、ホーム画面に追加した状態でないと通知が使えません（16.4以降）。
 * これは仕様なので、画面でもそう案内しています。
 */

import webpush from 'web-push';
import { cleanEnv } from './build-info';
import type { PushSubscriptionRecord, RunnerProfile } from './types';

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  /** 送信者の連絡先。プッシュサービス側が求める。 */
  subject: string;
}

export function vapidFromEnv(env: NodeJS.ProcessEnv = process.env): VapidConfig | null {
  const publicKey = cleanEnv(env.VAPID_PUBLIC_KEY) || cleanEnv(env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
  const privateKey = cleanEnv(env.VAPID_PRIVATE_KEY);
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    subject: cleanEnv(env.VAPID_SUBJECT) || 'mailto:noreply@example.com',
  };
}

export function isPushConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return vapidFromEnv(env) !== null;
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
}

export type PushOutcome = 'sent' | 'gone' | 'failed';

/** 宛先1つへ送る。**ここで例外を投げない。** 1人の失敗で全体を止めない。 */
export async function sendPush(
  subscription: PushSubscriptionRecord,
  payload: PushPayload,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PushOutcome> {
  const vapid = vapidFromEnv(env);
  if (!vapid) return 'failed';

  try {
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: subscription.keys },
      JSON.stringify(payload),
      { TTL: 12 * 3600 },
    );
    return 'sent';
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    // 404 / 410 は「その宛先はもう無い」。消してよい合図。
    if (status === 404 || status === 410) return 'gone';
    console.warn('[coach] push failed', status, (error as Error).message);
    return 'failed';
  }
}

/** 何度も失敗する宛先は捨てる。生きていない宛先に毎日送り続けない。 */
export const MAX_PUSH_FAILURES = 3;

/** 端末は複数持てる。同じ宛先なら上書きする。 */
export function addSubscription(
  profile: RunnerProfile,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  now: Date = new Date(),
): RunnerProfile {
  const others = (profile.pushSubscriptions ?? []).filter(
    (entry) => entry.endpoint !== subscription.endpoint,
  );
  return {
    ...profile,
    pushSubscriptions: [
      ...others,
      { endpoint: subscription.endpoint, keys: subscription.keys, createdAt: now.toISOString() },
    ].slice(-5),
    updatedAt: now.toISOString(),
  };
}

export function removeSubscription(
  profile: RunnerProfile,
  endpoint: string,
  now: Date = new Date(),
): RunnerProfile {
  const remaining = (profile.pushSubscriptions ?? []).filter((entry) => entry.endpoint !== endpoint);
  return { ...profile, pushSubscriptions: remaining, updatedAt: now.toISOString() };
}

/** 送信結果を宛先の一覧へ反映する。消えた宛先と、失敗が続く宛先を落とす。 */
export function applyOutcomes(
  profile: RunnerProfile,
  outcomes: { endpoint: string; outcome: PushOutcome }[],
  now: Date = new Date(),
): RunnerProfile {
  const byEndpoint = new Map(outcomes.map((entry) => [entry.endpoint, entry.outcome]));
  const next = (profile.pushSubscriptions ?? [])
    .map((subscription) => {
      const outcome = byEndpoint.get(subscription.endpoint);
      if (outcome === 'sent') return { ...subscription, failures: 0 };
      if (outcome === 'failed') return { ...subscription, failures: (subscription.failures ?? 0) + 1 };
      return outcome === 'gone' ? null : subscription;
    })
    .filter(
      (subscription): subscription is PushSubscriptionRecord =>
        subscription !== null && (subscription.failures ?? 0) < MAX_PUSH_FAILURES,
    );

  return { ...profile, pushSubscriptions: next, updatedAt: now.toISOString() };
}
