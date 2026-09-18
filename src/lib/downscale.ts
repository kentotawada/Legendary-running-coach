import type { ImageAttachment } from './types';
import { TOTAL_IMAGE_BUDGET_BYTES, base64Bytes } from './images';

/**
 * スマホのスクリーンショットは1枚で数MBある。10枚まとめて送れるようにすると、
 * そのままではサーバーレスのリクエスト上限（およそ4.5MB）を軽く超える。
 *
 * そこでブラウザ側で縮小してから送る。ただし目的は数字を読み取らせることなので、
 * 文字が潰れる手前で止める。枚数が多い時だけ段階的に品質を落とす作りにしている。
 */
const STEPS = [
  { maxDimension: 2000, quality: 0.92 },
  { maxDimension: 1800, quality: 0.88 },
  { maxDimension: 1600, quality: 0.84 },
  { maxDimension: 1400, quality: 0.8 },
  { maxDimension: 1200, quality: 0.74 },
];

/** 1枚しか送らない時に、必要以上に劣化させないための上限。 */
const MAX_BUDGET_PER_IMAGE = 900_000;

export interface PreparedImage extends ImageAttachment {
  /** 画面にサムネイルを出すための data URL。 */
  preview: string;
  /** 送信時の実バイト数。合計の見積もりに使う。 */
  bytes: number;
}

/** 枚数から1枚あたりの目安サイズを決める。 */
export function budgetForCount(count: number): number {
  const safeCount = Math.max(1, count);
  return Math.min(MAX_BUDGET_PER_IMAGE, Math.floor(TOTAL_IMAGE_BUDGET_BYTES / safeCount));
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('画像を読み込めませんでした。'));
    };
    image.src = url;
  });
}

function render(image: HTMLImageElement, maxDimension: number, quality: number): string {
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);

  const context = canvas.getContext('2d');
  if (!context) throw new Error('画像を処理できませんでした。');

  // スクリーンショットの細い文字を潰さないよう、補間の質を上げる。
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * 目安サイズに収まる範囲で、いちばん高い品質を選ぶ。
 * どの段階でも収まらない時は、最後の段階（最も軽い）を使う。
 */
export async function prepareImage(file: File, budgetBytes: number): Promise<PreparedImage> {
  const image = await loadImage(file);
  let dataUrl = '';
  let bytes = 0;

  for (const step of STEPS) {
    dataUrl = render(image, step.maxDimension, step.quality);
    bytes = base64Bytes(dataUrl.slice(dataUrl.indexOf(',') + 1));
    if (bytes <= budgetBytes) break;
  }

  return {
    mimeType: 'image/jpeg',
    data: dataUrl.slice(dataUrl.indexOf(',') + 1),
    preview: dataUrl,
    bytes,
  };
}

/** まとめて準備する。枚数が確定してから圧縮するので、合計が上限を超えにくい。 */
export async function prepareImages(files: File[]): Promise<PreparedImage[]> {
  const budget = budgetForCount(files.length);
  const prepared: PreparedImage[] = [];
  for (const file of files) {
    prepared.push(await prepareImage(file, budget));
  }
  return prepared;
}
