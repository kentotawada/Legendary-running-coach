/**
 * 姿勢から、種目ごとの出来を判定する。
 *
 * **ここには画面もカメラも出てこない。** 33点の座標を受け取って、
 * 「腰が落ちている」「肘が肩の真下にない」を返すだけの計算にしてある。
 * カメラ無しで確かめられる形にしておかないと、正しさを誰も検証できない。
 *
 * 判定の方針:
 *  - **一般的な「正しいフォーム」を押しつけない。** 体の作りは人によって違う。
 *    見るのは「その種目が狙っている形から、はっきり外れていないか」だけ。
 *  - 一度に1つしか言わない。3つ同時に直せる人はいない。
 *  - 痛みの話が出たら、判定より先に止める（ここではなく、呼び出す側の責任）。
 */

/** MediaPipe の姿勢点。画像の左上が (0,0)、右下が (1,1)。**y は下に向かって増える。** */
export interface Point {
  x: number;
  y: number;
  /** その点が見えている確からしさ(0〜1)。 */
  visibility?: number;
}

export type Landmarks = readonly Point[];

/** 使う点の番号。MediaPipe Pose の並びに従う。 */
export const LM = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftToe: 31,
  rightToe: 32,
} as const;

/** これより確からしさが低い点は、無いものとして扱う。 */
const SEEN = 0.5;

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** a-b-c のなす角（度）。b が頂点。 */
export function angleAt(a: Point, b: Point, c: Point): number {
  const ax = a.x - b.x;
  const ay = a.y - b.y;
  const cx = c.x - b.x;
  const cy = c.y - b.y;
  const dot = ax * cx + ay * cy;
  const size = Math.hypot(ax, ay) * Math.hypot(cx, cy);
  if (size === 0) return 0;
  // 丸め誤差で |cos| が 1 を超えることがある。acos が NaN になるので挟む。
  return (Math.acos(Math.min(1, Math.max(-1, dot / size))) * 180) / Math.PI;
}

/**
 * 直線 ab から見た p のずれ。
 * **符号を持たせる。** 「線から離れている」だけでは、腰が落ちたのか上がったのか分からない。
 * 正 = 画面の下側（y が大きい側）へずれている。
 * 長さは ab の長さで割ってあるので、写り方の大小に影響されない。
 */
export function offsetFromLine(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return 0;
  // 外積。画面座標は y が下向きなので、正の値が「下へのずれ」になる。
  return ((p.x - a.x) * dy - (p.y - a.y) * dx) / (length * length) * -1;
}

/** 左右のうち、よく見えているほう。横から撮ると片側が隠れる。 */
export function visibleSide(landmarks: Landmarks): 'left' | 'right' {
  const score = (indices: number[]) =>
    indices.reduce((sum, i) => sum + (landmarks[i]?.visibility ?? 0), 0);
  const left = score([LM.leftShoulder, LM.leftHip, LM.leftKnee, LM.leftAnkle]);
  const right = score([LM.rightShoulder, LM.rightHip, LM.rightKnee, LM.rightAnkle]);
  return right > left ? 'right' : 'left';
}

/** その種目を見るのに要る点が、ちゃんと写っているか。 */
export function allSeen(landmarks: Landmarks, indices: number[]): boolean {
  return indices.every((i) => (landmarks[i]?.visibility ?? 0) >= SEEN);
}

export interface Evaluation {
  /** 形になっているか。 */
  holding: boolean;
  /**
   * いま伝える一言。**同時に複数は返さない。**
   * 直すところが無ければ、できている旨を返す。
   */
  cue: string;
  /** 直すところがある時だけ true。声かけの強さを変えるために使う。 */
  fix: boolean;
  /** 画面に出す数値。無い種目もある。 */
  readout?: { label: string; value: string };
}

export interface ExerciseSpec {
  /** 説明図の id と揃える。コーチが同じ図を出せる。 */
  id: string;
  name: string;
  /** どこから撮るか。ここを間違えると、何を測っても意味がない。 */
  view: 'side' | 'front';
  /** 時間で数える種目か、回数で数える種目か。 */
  count: 'hold' | 'reps';
  /** 構えるまでの案内。 */
  setup: string;
  evaluate(landmarks: Landmarks): Evaluation;
}

const NOT_SEEN: Evaluation = {
  holding: false,
  cue: '全身がうつるように、少し下がってください',
  fix: false,
};

/**
 * プランク。
 * 見るのは2つだけ。**耳から足首までが一直線か**と、**肘が肩の真下か**。
 */
const PLANK: ExerciseSpec = {
  id: 'strength-plank',
  name: 'プランク',
  view: 'side',
  count: 'hold',
  setup: 'スマホを床に置いて、体の横から全身がうつるようにしてください',
  evaluate(landmarks) {
    const side = visibleSide(landmarks);
    const shoulder = landmarks[side === 'left' ? LM.leftShoulder : LM.rightShoulder];
    const hip = landmarks[side === 'left' ? LM.leftHip : LM.rightHip];
    const ankle = landmarks[side === 'left' ? LM.leftAnkle : LM.rightAnkle];
    const elbow = landmarks[side === 'left' ? LM.leftElbow : LM.rightElbow];

    const need = side === 'left'
      ? [LM.leftShoulder, LM.leftHip, LM.leftAnkle, LM.leftElbow]
      : [LM.rightShoulder, LM.rightHip, LM.rightAnkle, LM.rightElbow];
    if (!allSeen(landmarks, need)) return NOT_SEEN;

    // 肩から足首を結んだ線に対して、腰がどちらへどれだけ外れているか。
    const sag = offsetFromLine(hip, shoulder, ankle);
    const body = distance(shoulder, ankle);
    const elbowGap = body > 0 ? Math.abs(elbow.x - shoulder.x) / body : 0;

    // **一直線から6%を超えたら、見て分かるずれ。** ここより厳しくすると、
    // 呼吸で揺れるだけで注意され続けることになる。
    if (sag > 0.06) {
      return { holding: false, fix: true, cue: 'お尻が落ちています。お腹に力を入れて上げましょう' };
    }
    if (sag < -0.06) {
      return { holding: false, fix: true, cue: 'お尻が上がっています。もう少し下げて一直線に' };
    }
    if (elbowGap > 0.14) {
      return { holding: false, fix: true, cue: '肘を、肩の真下へ持ってきてください' };
    }
    return { holding: true, fix: false, cue: 'その形です。そのまま' };
  },
};

/**
 * カーフレイズ。
 * かかとの上がり幅で数える。**膝が曲がっていたら、ふくらはぎに乗っていない。**
 */
const CALF_RAISE: ExerciseSpec = {
  id: 'strength-calf-raise',
  name: 'カーフレイズ',
  view: 'side',
  count: 'reps',
  setup: 'スマホを床に置いて、体の横から全身がうつるようにしてください',
  evaluate(landmarks) {
    const side = visibleSide(landmarks);
    const hip = landmarks[side === 'left' ? LM.leftHip : LM.rightHip];
    const knee = landmarks[side === 'left' ? LM.leftKnee : LM.rightKnee];
    const ankle = landmarks[side === 'left' ? LM.leftAnkle : LM.rightAnkle];
    const heel = landmarks[side === 'left' ? LM.leftHeel : LM.rightHeel];
    const toe = landmarks[side === 'left' ? LM.leftToe : LM.rightToe];

    const need = side === 'left'
      ? [LM.leftHip, LM.leftKnee, LM.leftAnkle, LM.leftHeel, LM.leftToe]
      : [LM.rightHip, LM.rightKnee, LM.rightAnkle, LM.rightHeel, LM.rightToe];
    if (!allSeen(landmarks, need)) return NOT_SEEN;

    const kneeAngle = angleAt(hip, knee, ankle);
    // かかとが、つま先に対してどれだけ高いか。脚の長さで割って揃える。
    const leg = distance(hip, ankle);
    const lift = leg > 0 ? (toe.y - heel.y) / leg : 0;

    if (kneeAngle < 160) {
      return { holding: false, fix: true, cue: '膝が曲がっています。脚はまっすぐのまま' };
    }
    return {
      holding: lift > 0.08,
      fix: false,
      cue: lift > 0.08 ? 'いいですね。そこで1秒止めて' : 'かかとを、もっと高く',
      readout: { label: 'かかとの高さ', value: `${Math.round(Math.max(lift, 0) * 100)}` },
    };
  },
};

/**
 * 片脚スクワット。
 * **膝が内側へ入るのがいちばん見たいところ。** 正面から撮る。
 */
const SINGLE_LEG_SQUAT: ExerciseSpec = {
  id: 'strength-single-leg-squat',
  name: '片脚スクワット',
  view: 'front',
  count: 'reps',
  setup: 'スマホを正面に立てて、全身がうつるようにしてください',
  evaluate(landmarks) {
    const side = visibleSide(landmarks);
    const hip = landmarks[side === 'left' ? LM.leftHip : LM.rightHip];
    const knee = landmarks[side === 'left' ? LM.leftKnee : LM.rightKnee];
    const ankle = landmarks[side === 'left' ? LM.leftAnkle : LM.rightAnkle];

    const need = side === 'left'
      ? [LM.leftHip, LM.leftKnee, LM.leftAnkle]
      : [LM.rightHip, LM.rightKnee, LM.rightAnkle];
    if (!allSeen(landmarks, need)) return NOT_SEEN;

    const bend = angleAt(hip, knee, ankle);
    const leg = distance(hip, ankle);
    // 膝が、股関節と足首を結んだ線からどれだけ横へ出ているか。
    const inward = leg > 0 ? (knee.x - (hip.x + ankle.x) / 2) / leg : 0;
    const away = side === 'left' ? -inward : inward;

    if (away > 0.12) {
      return { holding: false, fix: true, cue: '膝が内に入っています。つま先の向きへ' };
    }
    return {
      holding: bend < 140,
      fix: false,
      cue: bend < 140 ? 'いい深さです' : 'もう少し深く沈んで',
      readout: { label: '膝の角度', value: `${Math.round(bend)}°` },
    };
  },
};

export const EXERCISES: ExerciseSpec[] = [PLANK, CALF_RAISE, SINGLE_LEG_SQUAT];

export function findExercise(id: string | undefined): ExerciseSpec | undefined {
  return EXERCISES.find((exercise) => exercise.id === id);
}
