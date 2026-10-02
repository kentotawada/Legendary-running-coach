import { describe, expect, it } from 'vitest';
import webpush from 'web-push';
import {
  PRIVATE_KEY_BYTES,
  PUBLIC_KEY_BYTES,
  SECRET_BYTES,
  base64UrlLength,
  generateSecret,
  generateVapidKeys,
  toBase64Url,
} from '@/lib/keygen';
import { checkVapidPair } from '@/lib/push';

/** 環境変数の差し替え。tests/billing.test.ts と同じ書き方。 */
const envOf = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

/**
 * 通知の鍵を、スマホだけで作る。
 *
 * **ここがずれていても、画面には何も出ない。**
 * 形の違う鍵を Vercel に入れると、通知が1通も飛ばないだけで、
 * エラーはどこにも出ない。だから web-push 本体に通して確かめる。
 */

// ブラウザの crypto.subtle と同じもの（Node 22 の Web Crypto）。
const subtle = globalThis.crypto.subtle;

describe('web-push が、そのまま受け取れる鍵を作る', () => {
  it('web-push の検査を通る', async () => {
    const keys = await generateVapidKeys(subtle);
    expect(() =>
      webpush.setVapidDetails('mailto:test@example.com', keys.publicKey, keys.privateKey),
    ).not.toThrow();
  });

  it('公開鍵は65バイト、秘密鍵は32バイト', async () => {
    const keys = await generateVapidKeys(subtle);
    expect(Buffer.from(keys.publicKey, 'base64url')).toHaveLength(PUBLIC_KEY_BYTES);
    expect(Buffer.from(keys.privateKey, 'base64url')).toHaveLength(PRIVATE_KEY_BYTES);
  });

  /** web-push は「=」が付いた鍵を受け取らない。 */
  it('パディングを付けない', async () => {
    const keys = await generateVapidKeys(subtle);
    expect(keys.publicKey).not.toContain('=');
    expect(keys.privateKey).not.toContain('=');
  });

  /** URL に入る文字だけ。+ と / が混ざると検査に落ちる。 */
  it('URL に使える文字だけで出す', async () => {
    const keys = await generateVapidKeys(subtle);
    expect(keys.publicKey).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(keys.privateKey).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('公開鍵は非圧縮のEC点（先頭が 0x04）', async () => {
    const keys = await generateVapidKeys(subtle);
    expect(Buffer.from(keys.publicKey, 'base64url')[0]).toBe(0x04);
  });

  it('呼ぶたびに違う鍵が出る', async () => {
    const a = await generateVapidKeys(subtle);
    const b = await generateVapidKeys(subtle);
    expect(a.privateKey).not.toBe(b.privateKey);
  });

  /**
   * ここが本番。実際に送る時と同じ頭をつくらせる。
   * 形が合っていても署名が通らない鍵なら、ここで落ちる。
   */
  it('その鍵で、実際に送信用の署名ができる', async () => {
    const keys = await generateVapidKeys(subtle);
    const headers = webpush.getVapidHeaders(
      'https://fcm.googleapis.com',
      'mailto:test@example.com',
      keys.publicKey,
      keys.privateKey,
      'aes128gcm',
    );
    expect(headers.Authorization).toContain('vapid');
    expect(headers.Authorization).toContain(keys.publicKey);
  });
});

describe('送信口の合言葉', () => {
  it('推測できない長さで出す', () => {
    const secret = generateSecret(globalThis.crypto);
    expect(Buffer.from(secret, 'base64url')).toHaveLength(SECRET_BYTES);
    // 32バイト = base64url で43文字。
    expect(secret.length).toBeGreaterThanOrEqual(43);
  });

  it('URL に使える文字だけで出す', () => {
    expect(generateSecret(globalThis.crypto)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('呼ぶたびに違う', () => {
    expect(generateSecret(globalThis.crypto)).not.toBe(generateSecret(globalThis.crypto));
  });
});

describe('base64url への変換', () => {
  it('+ と / を使わない', () => {
    // 0xFB 0xFF は、ふつうの base64 だと「+/」を含む並びになる。
    expect(toBase64Url(new Uint8Array([0xfb, 0xff, 0xfe]))).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('長さを数えられる', () => {
    expect(base64UrlLength(toBase64Url(new Uint8Array(32)))).toBe(32);
    expect(base64UrlLength(toBase64Url(new Uint8Array(65)))).toBe(65);
  });
});

/**
 * 公開鍵と秘密鍵が、対になっているか。
 *
 * **ここは、設定がそろって見えるのに動かない唯一の場所。**
 * web-push は長さと文字種しか見ないので、別々に作った鍵を組み合わせても
 * 素通しする。通知だけが1通も届かず、エラーもどこにも出ない。
 */
describe('鍵が対になっているかを見る', () => {
  it('同じ組なら ok', async () => {
    const keys = await generateVapidKeys(subtle);
    expect(
      checkVapidPair(envOf({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey })),
    ).toBe('ok');
  });

  /** 鍵を作り直して、片方だけ貼り替えた状態。 */
  it('別々に作った鍵を組み合わせたら mismatch', async () => {
    const a = await generateVapidKeys(subtle);
    const b = await generateVapidKeys(subtle);
    expect(
      checkVapidPair(envOf({ VAPID_PUBLIC_KEY: a.publicKey, VAPID_PRIVATE_KEY: b.privateKey })),
    ).toBe('mismatch');
  });

  it('web-push 自身が作った組も ok と読める', () => {
    const keys = webpush.generateVAPIDKeys();
    expect(
      checkVapidPair(envOf({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey })),
    ).toBe('ok');
  });

  it('旧名（NEXT_PUBLIC_）で入れてあっても見る', async () => {
    const keys = await generateVapidKeys(subtle);
    expect(
      checkVapidPair(
        envOf({
          NEXT_PUBLIC_VAPID_PUBLIC_KEY: keys.publicKey,
          VAPID_PRIVATE_KEY: keys.privateKey,
        }),
      ),
    ).toBe('ok');
  });

  it('設定が無ければ not-configured', () => {
    expect(checkVapidPair(envOf({}))).toBe('not-configured');
  });

  it('鍵として読めない値なら unreadable', () => {
    expect(
      checkVapidPair(envOf({ VAPID_PUBLIC_KEY: 'abc', VAPID_PRIVATE_KEY: 'みじかすぎる' })),
    ).toBe('unreadable');
  });

  /** web-push は、ちぐはぐな組み合わせを弾かない。だからこの検査が要る。 */
  it('web-push 自身は、ちぐはぐな組を弾かない', async () => {
    const a = await generateVapidKeys(subtle);
    const b = await generateVapidKeys(subtle);
    expect(() =>
      webpush.setVapidDetails('mailto:test@example.com', a.publicKey, b.privateKey),
    ).not.toThrow();
  });
});
