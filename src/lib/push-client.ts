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

/** 試し送りの結果。**そのまま画面に出す文章にする。** */
export interface PushTestResult {
  ok: boolean;
  /** 人が読む一行。何が起きたか、次に何をすればいいか。 */
  message: string;
}

const SKIP_TEXT: Record<string, string> = {
  'sent-today': '今日のぶんは、もう送り終わっています。',
  'nothing-to-say': '今日は知らせる用事がありません。用事が無い日は送りません。',
  'on-cooldown': '用事はありますが、最近同じことを送ったばかりです。',
};

/**
 * いま自分の端末へ1通送ってみる。
 *
 * **「来ない」の中身を切り分けるためのもの。** 端末に届くかどうかと、
 * 今日そもそも送る用事があったかどうかを、1回で両方返す。
 */
export async function sendTestPush(): Promise<PushTestResult> {
  let data: {
    devices?: number;
    sent?: number;
    gone?: number;
    failed?: number;
    plan?: { hour?: number; notifyHour?: number; skip?: string | null; title?: string | null };
    error?: string;
  };
  try {
    const response = await fetch('/api/push/test', { method: 'POST' });
    data = await response.json();
    if (!response.ok) return { ok: false, message: data.error ?? '試し送りができませんでした。' };
  } catch {
    return { ok: false, message: '通信に失敗しました。電波の入る場所でもう一度お試しください。' };
  }

  const devices = data.devices ?? 0;
  const sent = data.sent ?? 0;
  const gone = data.gone ?? 0;
  const plan = data.plan ?? {};

  if (devices === 0) {
    return {
      ok: false,
      message:
        'この端末がまだ登録されていません。いちど「通知を止める」を押してから、もう一度「通知を受け取る」を押してください。',
    };
  }
  if (sent === 0) {
    return {
      ok: false,
      message:
        gone > 0
          ? '登録が切れていました。古い宛先は消したので、もう一度「通知を受け取る」を押してください。'
          : '送信に失敗しました。端末の設定で、このアプリの通知が許可されているか確かめてください。',
    };
  }

  // ここまで来たら、配る仕組みは動いている。あとは「今日は何を送るはずだったか」。
  const today = plan.skip
    ? plan.skip === 'too-early'
      ? `毎朝の一言は${plan.notifyHour}時からです（いま${plan.hour}時）。`
      : (SKIP_TEXT[plan.skip] ?? '')
    : `今日はこれを送ります:「${plan.title}」`;

  return { ok: true, message: `届いたはずです。${today}` };
}
