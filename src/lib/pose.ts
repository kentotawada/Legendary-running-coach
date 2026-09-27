'use client';

import type { PoseLandmarker } from '@mediapipe/tasks-vision';

/**
 * 姿勢推定の読み込み。
 *
 * **映像は端末から出さない。** 判定は全部この端末の中で終わる。
 * 体が映っている動画をサーバーへ送る作りにはしない。
 *
 * 実行ファイルもモデルも、自分のところから配る（public/pose/）。
 * よそのCDNに頼ると、その日の都合で動いたり動かなかったりする。
 */

const WASM = '/pose/wasm';
const MODEL = '/pose/pose_landmarker_lite.task';

let loading: Promise<PoseLandmarker> | null = null;

export function loadPose(): Promise<PoseLandmarker> {
  // 一度読めば使い回す。30MB超を読み直させない。
  loading ??= (async () => {
    const { FilesetResolver, PoseLandmarker: Landmarker } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks(WASM);

    const options = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO' as const,
      numPoses: 1,
    });

    try {
      return await Landmarker.createFromOptions(fileset, options('GPU'));
    } catch {
      // GPU が使えない端末がある。**そこで諦めない。** CPU でも動く。
      return await Landmarker.createFromOptions(fileset, options('CPU'));
    }
  })();

  return loading;
}

/** 骨格を描くための、つなぐ点の組。 */
export const BONES: readonly (readonly [number, number])[] = [
  [11, 12], // 肩
  [11, 23],
  [12, 24],
  [23, 24], // 腰
  [11, 13],
  [13, 15], // 左腕
  [12, 14],
  [14, 16], // 右腕
  [23, 25],
  [25, 27], // 左脚
  [24, 26],
  [26, 28], // 右脚
  [27, 31],
  [28, 32], // 足
];
