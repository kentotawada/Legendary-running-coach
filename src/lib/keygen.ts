/**
 * 通知の鍵を、スマホだけで作る。
 *
 * **これまでの手順は、パソコンが要るものだった。**
 * `npx web-push generate-vapid-keys` はターミナルがなければ打てない。
 * スマホしか手元にない人は、ここで止まる。
 *
 * ここでやるのは、**ブラウザの中で鍵を作ること**だけ。
 * 作った鍵はこの端末から1歩も出ない。サーバーにも、こちらにも送らない。
 * 画面に出た文字を、本人が Vercel に貼る。それで終わり。
 *
 * ## web-push が期待する形
 *
 * node_modules/web-push/src/vapid-helper.js の実装に合わせてある。
 *
 *  - 公開鍵: 非圧縮のEC点（65バイト）を base64url
 *  - 秘密鍵: スカラー（32バイト）を base64url
 *
 * どちらも長さを検査されるので、形が違うと通知が1通も飛ばない。
 * **ここがずれていても画面には何も出ない**ので、テストで固定してある。
 */

/** VAPID の公開鍵の長さ（非圧縮EC点）。 */
export const PUBLIC_KEY_BYTES = 65;
/** VAPID の秘密鍵の長さ。 */
export const PRIVATE_KEY_BYTES = 32;

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/** バイト列を base64url（パディング無し）に。web-push の検査はパディングを許さない。 */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * 鍵をひと組つくる。
 *
 * **ブラウザの中だけで完結する。** 作ったものを、どこへも送らない。
 */
export async function generateVapidKeys(subtle: SubtleCrypto): Promise<VapidKeys> {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);

  // 公開鍵は raw で出すと、非圧縮のEC点（0x04 || X || Y）になる。
  const raw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  if (raw.length !== PUBLIC_KEY_BYTES) {
    throw new Error(`公開鍵の長さが ${raw.length} バイトになりました（${PUBLIC_KEY_BYTES} のはず）`);
  }

  /*
    秘密鍵は JWK で出す。`d` がスカラーの base64url なので、そのまま使える。
    pkcs8 で出すと ASN.1 の殻が付いてしまい、web-push の長さ検査に落ちる。
  */
  const jwk = await subtle.exportKey('jwk', pair.privateKey);
  const d = jwk.d;
  if (!d) throw new Error('秘密鍵を取り出せませんでした');

  // JWK の base64url にパディングは無いが、環境差に備えて落としておく。
  const privateKey = d.replace(/=+$/, '');
  if (base64UrlLength(privateKey) !== PRIVATE_KEY_BYTES) {
    throw new Error(
      `秘密鍵の長さが ${base64UrlLength(privateKey)} バイトになりました（${PRIVATE_KEY_BYTES} のはず）`,
    );
  }

  return { publicKey: toBase64Url(raw), privateKey };
}

/** base64url 文字列が表すバイト数。 */
export function base64UrlLength(value: string): number {
  const clean = value.replace(/=+$/, '');
  return Math.floor((clean.length * 3) / 4);
}

/** CRON_SECRET の長さ（バイト）。32バイト＝ base64url で43文字。 */
export const SECRET_BYTES = 32;

/**
 * 通知の送信口を守る合言葉。
 * **自分で考えなくていい。** 「長い文字列を決めてください」は、
 * たいてい短くて推測できるものになる。
 */
export function generateSecret(random: Crypto): string {
  const bytes = new Uint8Array(SECRET_BYTES);
  random.getRandomValues(bytes);
  return toBase64Url(bytes);
}
