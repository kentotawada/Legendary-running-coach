import type { ImageAttachment } from './types';

/**
 * スマホのスクリーンショットは1枚で数MBある。そのまま送るとリクエストが通らないので、
 * ブラウザ側で縮小してから送る。ただし数字を読み取らせるのが目的なので、
 * 文字が潰れない程度の解像度と品質は残す。
 */
const MAX_DIMENSION = 2000;
const JPEG_QUALITY = 0.92;

export interface PreparedImage extends ImageAttachment {
  /** 画面にサムネイルを出すための data URL。 */
  preview: string;
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

export async function prepareImage(file: File): Promise<PreparedImage> {
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(image.width, image.height));
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('画像を処理できませんでした。');

  // スクリーンショットの細い文字を潰さないよう、補間の質を上げる。
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);

  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  const data = dataUrl.slice(dataUrl.indexOf(',') + 1);

  return { mimeType: 'image/jpeg', data, preview: dataUrl };
}
