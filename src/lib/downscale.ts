import type { ImageAttachment } from './types';
import { PDF_TYPE, TOTAL_IMAGE_BUDGET_BYTES, base64Bytes, looksLikePdf } from './images';

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
  /**
   * 保存して後から見返すための小さい版。
   * 送った画像そのものを保存すると保存先がすぐ膨れるので、
   * 「後で確かめられる大きさ」まで落としたものを別に作る。
   */
  thumbnail: string;
  /** 送信時の実バイト数。合計の見積もりに使う。 */
  bytes: number;
}

/** 見返し用の大きさ。画面いっぱいに開いても文字がつぶれない下限。 */
const THUMBNAIL_MAX_DIMENSION = 560;
const THUMBNAIL_QUALITY = 0.62;

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

interface Tile {
  y: number;
  height: number;
}

/**
 * 縦に長い画像は、切り分けてから縮小する。
 *
 * スクロールして撮った1枚や、繋ぎ合わせた画像は、縦横比が極端になる。
 * 長辺に合わせて縮めると、**横幅が100px台まで潰れて数字が読めなくなる。**
 * 読めない画像を送るのは、送っていないのと同じ。
 */
const TALL_RATIO = 2.2;
/** 切り分けた1枚の縦横比の目安。スマホの画面に近い形にする。 */
const TILE_ASPECT = 1.6;
/** 切り分ける上限。多すぎると1枚あたりの容量が足りなくなる。 */
export const MAX_TILES = 6;
/** 境目で数字が切れないように、少し重ねて切る。 */
const OVERLAP = 0.04;

export function tilesFor(width: number, height: number): Tile[] {
  if (width <= 0 || height <= 0) return [{ y: 0, height }];
  if (height / width <= TALL_RATIO) return [{ y: 0, height }];

  const wanted = Math.ceil(height / (width * TILE_ASPECT));
  const count = Math.min(MAX_TILES, Math.max(2, wanted));
  const step = height / count;
  const overlap = step * OVERLAP;

  return Array.from({ length: count }, (_, index) => {
    const start = Math.max(0, index * step - overlap);
    const end = Math.min(height, (index + 1) * step + overlap);
    return { y: Math.round(start), height: Math.round(end - start) };
  });
}

function render(
  image: HTMLImageElement,
  tile: Tile,
  maxDimension: number,
  quality: number,
): string {
  const scale = Math.min(1, maxDimension / Math.max(image.width, tile.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(tile.height * scale);

  const context = canvas.getContext('2d');
  if (!context) throw new Error('画像を処理できませんでした。');

  // スクリーンショットの細い文字を潰さないよう、補間の質を上げる。
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    image,
    0,
    tile.y,
    image.width,
    tile.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  return canvas.toDataURL('image/jpeg', quality);
}

/** PDF はそのまま渡す。縮められないので、大きすぎるものはここで断る。 */
export const MAX_PDF_BYTES = 2_500_000;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // 一度に渡すと引数の数で落ちるので、小分けにする。
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** PDF には見た目が無い。添付欄に出す絵をこちらで作る。 */
function pdfPreview(name: string): string {
  const label = (name || 'PDF').replace(/[<>&]/g, '').slice(0, 18);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320" viewBox="0 0 240 320">
    <rect width="240" height="320" rx="16" fill="#f3f1ee"/>
    <rect x="46" y="60" width="148" height="180" rx="10" fill="#fff" stroke="#d9d4cd" stroke-width="3"/>
    <path d="M150 60v34h34" fill="none" stroke="#d9d4cd" stroke-width="3"/>
    <g fill="#c9c3bb">
      <rect x="66" y="120" width="108" height="8" rx="4"/>
      <rect x="66" y="142" width="88" height="8" rx="4"/>
      <rect x="66" y="164" width="108" height="8" rx="4"/>
      <rect x="66" y="186" width="70" height="8" rx="4"/>
    </g>
    <text x="120" y="272" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#6b645c">${label}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * iPhone の「フルページ」スクリーンショットは PDF で保存される。
 * **長い画面を1枚で渡せる唯一の道**なので、縮小はせずそのまま送る。
 */
async function preparePdf(file: File): Promise<PreparedImage> {
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > MAX_PDF_BYTES) {
    throw new Error('PDF が大きすぎます。ページを分けるか、画像で送ってください。');
  }
  const data = toBase64(buffer);
  const preview = pdfPreview(file.name);

  return { mimeType: PDF_TYPE, data, preview, thumbnail: preview, bytes: buffer.byteLength };
}

/**
 * 目安サイズに収まる範囲で、いちばん高い品質を選ぶ。
 * どの段階でも収まらない時は、最後の段階（最も軽い）を使う。
 *
 * 縦に長い画像は切り分けるので、1枚から複数枚になることがある。
 */
export async function prepareFile(file: File, budgetBytes: number): Promise<PreparedImage[]> {
  if (looksLikePdf(file)) return [await preparePdf(file)];

  const image = await loadImage(file);
  const tiles = tilesFor(image.width, image.height);
  const perTile = Math.max(120_000, Math.floor(budgetBytes / tiles.length));

  return tiles.map((tile) => {
    let dataUrl = '';
    let bytes = 0;
    for (const step of STEPS) {
      dataUrl = render(image, tile, step.maxDimension, step.quality);
      bytes = base64Bytes(dataUrl.slice(dataUrl.indexOf(',') + 1));
      if (bytes <= perTile) break;
    }

    return {
      mimeType: 'image/jpeg',
      data: dataUrl.slice(dataUrl.indexOf(',') + 1),
      preview: dataUrl,
      thumbnail: render(image, tile, THUMBNAIL_MAX_DIMENSION, THUMBNAIL_QUALITY),
      bytes,
    };
  });
}

export interface PrepareResult {
  images: PreparedImage[];
  /** 読み込めなかったファイル。読めた分は捨てずに残す。 */
  failed: string[];
  /** 実際に使えたファイル。添付欄の並びをここに合わせる。 */
  accepted: File[];
}

/**
 * まとめて準備する。枚数が確定してから圧縮するので、合計が上限を超えにくい。
 *
 * 1枚読めなかっただけで全部やり直しにしない。
 * 10枚送ろうとして1枚が壊れていた時に、9枚まで捨てられるのは理不尽すぎる。
 */
export async function prepareImages(files: File[]): Promise<PrepareResult> {
  const budget = budgetForCount(files.length);
  const images: PreparedImage[] = [];
  const accepted: File[] = [];
  const failed: string[] = [];

  for (const file of files) {
    try {
      images.push(...(await prepareFile(file, budget)));
      accepted.push(file);
    } catch (error) {
      failed.push(
        error instanceof Error && error.message
          ? `${file.name || '名前のないファイル'}（${error.message}）`
          : file.name || '名前のないファイル',
      );
    }
  }

  return { images, failed, accepted };
}

/**
 * 保存してある表示用の画像を、もう一度送れるファイルに戻す。
 *
 * 一度送った画像をもう一度使いたい場面は多い（同じ練習の続きを相談する、
 * 本文だけ直して送り直す）。そのたびに写真アプリを開かせるのは手間でしかない。
 */
export function dataUrlToFile(dataUrl: string, name: string): File | null {
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:image/') || comma < 0) return null;

  const mimeType = dataUrl.slice(5, dataUrl.indexOf(';'));
  try {
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], name, { type: mimeType });
  } catch {
    // 壊れた data URL。黙って諦める（呼び出し側が枚数で気づける）。
    return null;
  }
}

/** 拡張子まで含めた、再添付用の名前。 */
export function reattachName(index: number, dataUrl: string): string {
  const extension = dataUrl.startsWith('data:image/png') ? 'png' : 'jpg';
  return `再添付-${index + 1}.${extension}`;
}
