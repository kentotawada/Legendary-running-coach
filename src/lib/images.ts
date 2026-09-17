import type { ImageAttachment } from './types';

/**
 * 本文を書かずに画像だけ送られた時の文言。
 * 画面の吹き出しとサーバー側のフォールバックで同じ文にして、
 * 送った本人が「何を頼んだことになっているか」を見て分かるようにする。
 */
export const DEFAULT_IMAGE_MESSAGE = '練習データのスクリーンショットです。読み取って分析してください。';

/** Gemini が扱える形式だけを通す。 */
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

/** 1回に添付できる枚数。ラップ画面と概要画面で2枚、程度を想定。 */
export const MAX_IMAGES = 3;

/**
 * サーバーが受け取る合計サイズの上限。
 * クライアント側で縮小してから送るので、通常は数百KBに収まる。
 * これを超える場合は縮小に失敗しているので、黙って重いリクエストを投げるより弾く。
 */
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

export interface ImageValidation {
  images: ImageAttachment[];
  error?: string;
}

/** base64 文字列の実バイト数。 */
export function base64Bytes(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

/**
 * 受け取った添付を検証する。壊れた入力で例外を投げず、理由を返す。
 * data URL の接頭辞が付いたまま送られてきても受け取れるようにしておく。
 */
export function validateImages(input: unknown): ImageValidation {
  if (input === undefined || input === null) return { images: [] };
  if (!Array.isArray(input)) return { images: [], error: '画像の形式が正しくありません。' };
  if (input.length === 0) return { images: [] };
  if (input.length > MAX_IMAGES) {
    return { images: [], error: `画像は一度に${MAX_IMAGES}枚までです。` };
  }

  const images: ImageAttachment[] = [];
  let total = 0;

  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return { images: [], error: '画像の形式が正しくありません。' };
    const candidate = raw as { mimeType?: unknown; data?: unknown };
    const mimeType = typeof candidate.mimeType === 'string' ? candidate.mimeType.toLowerCase() : '';
    let data = typeof candidate.data === 'string' ? candidate.data : '';

    // "data:image/jpeg;base64,...." で送られてきた場合に備える。
    const commaIndex = data.indexOf(',');
    if (data.startsWith('data:') && commaIndex > 0) data = data.slice(commaIndex + 1);

    if (!ALLOWED_TYPES.includes(mimeType)) {
      return { images: [], error: '対応していない画像形式です。JPEG / PNG / WebP で送ってください。' };
    }
    if (!data) return { images: [], error: '画像データが空です。' };

    total += base64Bytes(data);
    if (total > MAX_TOTAL_BYTES) {
      return { images: [], error: '画像の合計サイズが大きすぎます。枚数を減らして送ってください。' };
    }

    images.push({ mimeType, data });
  }

  return { images };
}
