'use client';

/**
 * 端末側の通知の手続き。
 *
 * 気をつけること:
 *  - **許可を求めるのは、本人が押した直後だけ。** 開いた瞬間に出す確認は、ほぼ確実に拒否される。
 *  - iOS は「ホーム画面に追加」していないと、そもそも使えない（16.4以降）。
 *    使えない端末では、できない約束をしない。
 */

export type PushAvailability = 'ready' | 'needs-install' | 'unsupported';

/** この端末で通知が使えるか。iOS だけは、ホーム画面からの起動かどうかまで見る。 */
export function pushAvailability(): PushAvailability {
  if (typeof window === 'undefined') return 'unsupported';
  const supported =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  const ua = navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;

  if (!supported) return isIos && !standalone ? 'needs-install' : 'unsupported';
  return 'ready';
}

/** いまこの端末が購読しているか。 */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushAvailability() !== 'ready') return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    return (await registration?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/** base64url の公開鍵を、購読が求める形に直す。 */
function toApplicationServerKey(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalized);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

export interface SubscribeResult {
  ok: boolean;
  reason?: 'denied' | 'unavailable' | 'failed';
}

/**
 * 通知を受け取れるようにする。
 * **必ず本人の操作（ボタン）から呼ぶこと。**
 */
export async function subscribeToPush(): Promise<SubscribeResult> {
  if (pushAvailability() !== 'ready') return { ok: false, reason: 'unavailable' };

  try {
    const keyResponse = await fetch('/api/push/key');
    const key = (await keyResponse.json()) as { available?: boolean; publicKey?: string };
    if (!key.available || !key.publicKey) return { ok: false, reason: 'unavailable' };

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { ok: false, reason: 'denied' };

    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        // 届いたら必ず画面に出す約束。黙って情報だけ取る購読は、ブラウザ側が許さない。
        userVisibleOnly: true,
        applicationServerKey: toApplicationServerKey(key.publicKey) as BufferSource,
      }));

    const json = subscription.toJSON() as { endpoint?: string; keys?: Record<string, string> };
    const response = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
    });
    if (!response.ok) return { ok: false, reason: 'failed' };
    return { ok: true };
  } catch (error) {
    console.warn('[coach] push subscribe failed', error);
    return { ok: false, reason: 'failed' };
  }
}

/** 通知を止める。端末側の購読も、サーバー側の宛先も消す。 */
export async function unsubscribeFromPush(): Promise<boolean> {
  try {
    const subscription = await currentSubscription();
    const endpoint = subscription?.endpoint;
    if (subscription) await subscription.unsubscribe();
    await fetch('/api/push/subscribe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    });
    return true;
  } catch {
    return false;
  }
}
