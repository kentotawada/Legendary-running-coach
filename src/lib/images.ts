import type { ImageAttachment } from './types';

/**
 * 本文を書かずに画像だけ送られた時の文言。
 * 画面の吹き出しとサーバー側のフォールバックで同じ文にして、
 * 送った本人が「何を頼んだことになっているか」を見て分かるようにする。
 */
export const DEFAULT_IMAGE_MESSAGE = '練習データのスクリーンショットです。読み取って分析してください。';

/** Gemini が扱える形式だけを通す。 */
const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  // iPhone の「フルページ」スクリーンショットは PDF で保存される。
  // 長い画面を1枚で渡せる唯一の道なので、ここで受ける。
  'application/pdf',
];

export const PDF_TYPE = 'application/pdf';

/** PDF として扱うファイルか。 */
export function looksLikePdf(file: { type?: string; name?: string }): boolean {
  if ((file.type ?? '').toLowerCase() === PDF_TYPE) return true;
  return /\.pdf$/i.test(file.name ?? '');
}

/**
 * ファイル選択で見せる形式。
 *
 * **拡張子を混ぜないこと。** iOS Safari は accept を UTI に変換するが、
 * 対応の取れない拡張子が混ざると写真ライブラリを出さず、
 * 「ファイル」だけの画面になることがある。それでは写真を選べない。
 * image/* だけにしておけば、写真・撮影・ファイルの3つが出る。
 */
export const FILE_ACCEPT = 'image/*';

/** 画像として扱えるファイルか。拡張子しか手がかりが無い場合にも答えを出す。 */
export function looksLikeImage(file: { type?: string; name?: string }): boolean {
  const type = (file.type ?? '').toLowerCase();
  if (type.startsWith('image/')) return true;
  // iCloud 経由などで type が空のことがある。名前で判断する。
  return /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?)$/i.test(file.name ?? '');
}

/** コーチに読ませる添付（画像か PDF）か。練習の記録ファイルと振り分けるために使う。 */
export function looksLikeAttachment(file: { type?: string; name?: string }): boolean {
  return looksLikeImage(file) || looksLikePdf(file);
}

/**
 * 1回に添付できる枚数。
 * 心拍・ペース・ピッチ・高度・ラップなど、アプリの詳細画面をまとめて送れるようにしている。
 */
export const MAX_IMAGES = 10;

/**
 * クライアントが縮小時に狙う合計サイズ（デコード後）。
 * base64 にすると約1.33倍に膨らむため、これを 2.5MB に置くと本文は 3.3MB ほど。
 * サーバーレスのリクエスト上限（およそ4.5MB）に対して余裕がある。
 */
export const TOTAL_IMAGE_BUDGET_BYTES = 2_500_000;

/**
 * サーバーが受け取る合計サイズの上限（デコード後）。
 * 縮小に失敗した重いリクエストを、黙って通さずここで弾く。
 */
export const MAX_TOTAL_BYTES = 3_000_000;

export interface ImageValidation {
  images: ImageAttachment[];
  /** 見返し用の控え（data URL）。送られてこなければ空。 */
  thumbnails: string[];
  error?: string;
}

/** 控え1枚の上限。これを超えるものは保存せず、捨てる。 */
const MAX_THUMBNAIL_CHARS = 200_000;

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
  if (input === undefined || input === null) return { images: [], thumbnails: [] };
  if (!Array.isArray(input)) {
    return { images: [], thumbnails: [], error: '画像の形式が正しくありません。' };
  }
  if (input.length === 0) return { images: [], thumbnails: [] };
  if (input.length > MAX_IMAGES) {
    return { images: [], thumbnails: [], error: `画像は一度に${MAX_IMAGES}枚までです。` };
  }

  const images: ImageAttachment[] = [];
  const thumbnails: string[] = [];
  let total = 0;

  for (const raw of input) {
    if (!raw || typeof raw !== 'object') {
      return { images: [], thumbnails: [], error: '画像の形式が正しくありません。' };
    }
    const candidate = raw as { mimeType?: unknown; data?: unknown; thumbnail?: unknown };
    const mimeType = typeof candidate.mimeType === 'string' ? candidate.mimeType.toLowerCase() : '';
    let data = typeof candidate.data === 'string' ? candidate.data : '';

    // "data:image/jpeg;base64,...." や "data:application/pdf;base64,..." に備える。
    const commaIndex = data.indexOf(',');
    if (data.startsWith('data:') && commaIndex > 0) data = data.slice(commaIndex + 1);

    if (!ALLOWED_TYPES.includes(mimeType)) {
      return {
        images: [],
        thumbnails: [],
        error: '対応していない形式です。JPEG / PNG / WebP の画像か、PDF で送ってください。',
      };
    }
    if (!data) return { images: [], thumbnails: [], error: '画像データが空です。' };

    total += base64Bytes(data);
    if (total > MAX_TOTAL_BYTES) {
      return {
        images: [],
        thumbnails: [],
        error: '画像の合計サイズが大きすぎます。枚数を減らして送ってください。',
      };
    }

    images.push({ mimeType, data });

    // 控えは無くても対話は成立する。壊れていたら黙って捨てる。
    const thumbnail = typeof candidate.thumbnail === 'string' ? candidate.thumbnail : '';
    if (thumbnail.startsWith('data:image/') && thumbnail.length <= MAX_THUMBNAIL_CHARS) {
      thumbnails.push(thumbnail);
    }
  }

  return { images, thumbnails };
}
