'use client';

import type { PoseLandmarker } from '@mediapipe/tasks-vision';

/**
 * 姿勢推定の読み込みと、骨格の描画。
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

let frameLoading: Promise<PoseLandmarker> | null = null;

/**
 * 1コマずつ見るほうの読み込み。
 *
 * **動画用とは別に持つ。** 動画用は時刻が前へ進むことを前提にしているので、
 * 好きな時刻へ飛ばしながら読ませると結果が壊れる。
 */
export function loadPoseForFrames(): Promise<PoseLandmarker> {
  frameLoading ??= (async () => {
    const { FilesetResolver, PoseLandmarker: Landmarker } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks(WASM);

    const options = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'IMAGE' as const,
      numPoses: 1,
    });

    try {
      return await Landmarker.createFromOptions(fileset, options('GPU'));
    } catch {
      return await Landmarker.createFromOptions(fileset, options('CPU'));
    }
  })();

  return frameLoading;
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

/** 左脚・右脚それぞれの骨。片脚だけ色を変えたい時に使う。 */
export const LEG_BONES = {
  left: [
    [23, 25],
    [25, 27],
    [27, 31],
  ],
  right: [
    [24, 26],
    [26, 28],
    [28, 32],
  ],
} as const;

/** 関節として丸を置く点。指先まで置くと、点だらけになって形が読めない。 */
const JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28] as const;

/** 顔の点。頭の丸をどこに置くかを決めるのに使う。 */
const FACE = [0, 2, 5, 7, 8, 9, 10] as const;

/** これより確からしさが低い点は、座標も当てにならない。 */
const SEEN = 0.3;

export interface Point2 {
  x: number;
  y: number;
  visibility?: number;
}

/** 0〜1で表した切り出し枠。 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 体が入っているところだけを切り出す枠。
 *
 * **画面をそのまま出すと、人が小さすぎて形が読めない。**
 * 全身を入れようとすると、たいてい引きで撮ることになり、
 * 人は画面の3分の1ほどにしかならない。そこだけ大きく出す。
 *
 * @param aspect 欲しい枠の 幅÷高さ。写す先の形に合わせる。
 */
/** ふちどりを付けただけの、まだ形を整えていない枠。 */
interface Raw {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

function rawBox(points: readonly Point2[]): Raw | null {
  const seen = points.filter((p) => (p.visibility ?? 0) >= SEEN);
  // 点が数個しか見えていないなら、枠を決める根拠が無い。切らないほうが安全。
  if (seen.length < 8) return null;

  const x0 = Math.min(...seen.map((p) => p.x));
  const x1 = Math.max(...seen.map((p) => p.x));
  const y0 = Math.min(...seen.map((p) => p.y));
  const y1 = Math.max(...seen.map((p) => p.y));

  // ふちに体が接していると窮屈に見える。頭の上は少し多めに空ける。
  const padX = Math.max((x1 - x0) * 0.2, 0.02);
  const tall = y1 - y0;
  const top = Math.max(tall * 0.14, 0.02);
  const bottom = Math.max(tall * 0.08, 0.02);

  return {
    cx: (x0 + x1) / 2,
    cy: (y0 - top + y1 + bottom) / 2,
    w: x1 - x0 + padX * 2,
    h: tall + top + bottom,
  };
}

/** 頼まれた形に伸ばして、画面の中に収める。 */
function fitBox(raw: Raw, aspect: number): Box {
  let w = raw.w;
  let h = raw.h;
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;

  // 枠の外は撮れていない。画面の中に収める。
  w = Math.min(w, 1);
  h = Math.min(h, 1);

  return {
    x: Math.min(Math.max(raw.cx - w / 2, 0), 1 - w),
    y: Math.min(Math.max(raw.cy - h / 2, 0), 1 - h),
    w,
    h,
  };
}

/**
 * 体が入っているところだけを切り出す枠。
 *
 * **画面をそのまま出すと、人が小さすぎて形が読めない。**
 * 全身を入れようとすると、たいてい引きで撮ることになり、
 * 人は画面の3分の1ほどにしかならない。そこだけ大きく出す。
 *
 * @param aspect 欲しい枠の 幅÷高さ。写す先の形に合わせる。
 */
export function bodyBox(points: readonly Point2[], aspect: number): Box | null {
  const raw = rawBox(points);
  return raw ? fitBox(raw, aspect) : null;
}

/**
 * コマ送り用の枠。人を追いながら、**拡大率は変えない。**
 *
 * コマごとに枠の大きさを決め直すと、送るたびに人が伸び縮みして、
 * 動きそのものを見比べられなくなる。大きさは全コマで揃え、
 * 位置だけがその人について動く。中継の追いカメラと同じ考え方。
 *
 * 大きさは、いちばん大きいコマではなく上位1割のところで決める。
 * 1コマだけ点が飛んでも、それに引きずられて全部が小さくならないように。
 */
export function steadyBoxes(
  frames: readonly (readonly Point2[])[],
  aspect: number,
): (Box | null)[] {
  const raws = frames.map(rawBox);
  const seen = raws.filter((raw): raw is Raw => raw !== null);
  if (seen.length === 0) return raws.map(() => null);

  const high = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    // いちばん上は取らない。1コマだけ点が飛んだ時に、そこへ全部を合わせないため。
    return sorted[Math.floor((sorted.length - 1) * 0.9)];
  };
  const w = high(seen.map((raw) => raw.w));
  const h = high(seen.map((raw) => raw.h));

  return raws.map((raw) => (raw ? fitBox({ ...raw, w, h }, aspect) : null));
}

/** 枠の中を0〜1として読み替える。切り出した絵の上に骨格を重ねるため。 */
export function inBox<T extends Point2>(points: readonly T[], box: Box): T[] {
  return points.map((p) => ({ ...p, x: (p.x - box.x) / box.w, y: (p.y - box.y) / box.h }));
}

export interface SkeletonStyle {
  /** 線の太さ。写す先の幅から決める。 */
  width: number;
  /** ふつうの骨の色。 */
  color?: string;
  /** 目立たせたい骨と、その色。 */
  highlight?: { bones: readonly (readonly [number, number])[]; color: string };
}

/**
 * 骨格を描く。
 *
 * **細い線を1本引くだけでは、実際の映像の上では読めない。**
 * 背景が明るければ白は飛び、暗ければ黒は沈む。
 * 暗い縁取りの上に明るい線を重ねて、どんな背景でも輪郭が立つようにする。
 *
 * **頭と関節を描く。** 首から上が無く、関節に印も無い線の集まりは、
 * 人の形として読めない。丸があるだけで、体に見える。
 */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  points: readonly Point2[],
  { width, color = '#ffffff', highlight }: SkeletonStyle,
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const casing = 'rgba(0,0,0,0.6)';

  const at = (i: number) => {
    const p = points[i];
    return p ? ([p.x * w, p.y * h] as const) : null;
  };

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const stroke = (
    bones: readonly (readonly [number, number])[],
    paint: string,
    thickness: number,
  ) => {
    ctx.strokeStyle = paint;
    ctx.lineWidth = thickness;
    for (const [from, to] of bones) {
      const a = at(from);
      const b = at(to);
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
  };

  // 頭の位置。顔の点の真ん中に置き、大きさは首までの距離から決める。
  const neck = (() => {
    const l = at(11);
    const r = at(12);
    if (l && r) return [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2] as const;
    return l ?? r;
  })();
  const face = FACE.map((i) => ((points[i]?.visibility ?? 0) >= SEEN ? at(i) : null)).filter(
    (p): p is readonly [number, number] => p !== null,
  );
  const head =
    neck && face.length > 0
      ? (() => {
          const cx = face.reduce((sum, p) => sum + p[0], 0) / face.length;
          const cy = face.reduce((sum, p) => sum + p[1], 0) / face.length;
          const reach = Math.hypot(cx - neck[0], cy - neck[1]);
          // 首から顔の中心までは、頭の半径の1.8倍くらい。小さくなりすぎないように床を入れる。
          const r = Math.max(reach * 0.55, width * 1.6);
          return { cx, cy, r, reach };
        })()
      : null;

  const drawHead = (paint: string, thickness: number) => {
    if (!head || !neck) return;
    ctx.strokeStyle = paint;
    ctx.lineWidth = thickness;
    // 首。頭の丸の縁まで引く。丸の中に線が入ると、顔が汚れて見える。
    if (head.reach > head.r) {
      const ux = (neck[0] - head.cx) / head.reach;
      const uy = (neck[1] - head.cy) / head.reach;
      ctx.beginPath();
      ctx.moveTo(neck[0], neck[1]);
      ctx.lineTo(head.cx + ux * head.r, head.cy + uy * head.r);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(head.cx, head.cy, head.r, 0, Math.PI * 2);
    ctx.stroke();
  };

  // 縁取りを先に、太く。ここが効いて、明るい背景でも線が消えない。
  stroke(BONES, casing, width * 2.1);
  drawHead(casing, width * 2.1);
  stroke(BONES, color, width);
  drawHead(color, width);

  if (highlight) {
    stroke(highlight.bones, casing, width * 2.5);
    stroke(highlight.bones, highlight.color, width * 1.4);
  }

  // 関節。丸があるだけで、棒の集まりが体として読める。
  const highlighted = new Set(highlight?.bones.flatMap(([a, b]) => [a, b]) ?? []);
  for (const index of JOINTS) {
    const p = at(index);
    if (!p) continue;
    const r = width * (highlighted.has(index) ? 1.15 : 0.9);
    ctx.beginPath();
    ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
    ctx.fillStyle = casing;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p[0], p[1], r * 0.7, 0, Math.PI * 2);
    ctx.fillStyle = highlighted.has(index) ? (highlight?.color ?? color) : color;
    ctx.fill();
  }

  ctx.restore();
}
