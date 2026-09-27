/**
 * 走っている数秒から、フォームを数字にする。
 *
 * **ここには画面もカメラも動画も出てこない。** 1コマずつの座標の並びを受け取って、
 * 接地の瞬間を見つけ、その瞬間の形を測るだけの計算にしてある。
 * カメラ無しで確かめられる形にしておかないと、正しさを誰も検証できない。
 *
 * 測る方針:
 *  - **身長を使わない。** 持っていないし、聞いても正確に入る保証がない。
 *    全部「脚の長さに対する比」で出す。見るのは自分の中での変化なので、それで足りる。
 *  - **一般的な「良い数値」を当てはめない。** 接地の位置も体幹の角度も、
 *    速度と体の作りで変わる。ここは測るだけ。良し悪しを言うのは人の仕事。
 *  - 測れなかった時は、黙って0を返さない。measured を false にして理由を返す。
 */

import { LM, angleAt, distance, type Landmarks } from './exercise';

/** 1コマ。t は動画の先頭からの秒数。 */
export interface Frame {
  t: number;
  points: Landmarks;
}

export interface Contact {
  /** 何コマ目か。 */
  index: number;
  t: number;
  side: 'left' | 'right';
  /**
   * 接地した足が、腰の真下からどれだけ前に出ているか。脚の長さに対する比。
   * **正が前。** 大きいほど、体より前で着いている。
   */
  ahead: number;
  /** 接地した瞬間の膝の角度(度)。180に近いほど伸びきっている。 */
  knee: number;
  /** 体幹の前傾(度)。**正が進行方向へ傾いている。** */
  lean: number;
}

export interface GaitReport {
  measured: boolean;
  /** 測れなかった時の理由。画面にそのまま出す。 */
  note?: string;
  contacts: Contact[];
  /** 進行方向。+1 なら画面の右へ進んでいる。 */
  facing: 1 | -1;
  /** 1分あたりの歩数。コマ数が足りないと出ない。 */
  cadence?: number;
  /** 上下動。脚の長さに対する比。 */
  bounce?: number;
  /** 接地位置の平均（脚の長さに対する比）。 */
  ahead?: number;
  /** 接地時の膝の角度の平均(度)。 */
  knee?: number;
  /** 体幹の前傾の平均(度)。 */
  lean?: number;
}

/** これより確からしさが低いコマは、無かったことにする。 */
const SEEN = 0.5;

/** 接地をこれだけ見つけられないと、平均を出す意味がない。 */
const MIN_CONTACTS = 3;

/** 3点の移動平均。1コマだけのぶれで山を数えないため。 */
export function smooth(values: readonly number[]): number[] {
  return values.map((value, i) => {
    const a = values[i - 1] ?? value;
    const b = values[i + 1] ?? value;
    return (a + value + b) / 3;
  });
}

/**
 * 山の位置。
 * **近すぎる山は1つにまとめる。** 同じ一歩を2回数えると、ピッチが倍になる。
 */
export function peaks(values: readonly number[], minGap: number): number[] {
  const found: number[] = [];

  for (let i = 1; i < values.length - 1; i += 1) {
    if (!(values[i] >= values[i - 1] && values[i] > values[i + 1])) continue;

    const last = found[found.length - 1];
    if (last !== undefined && i - last < minGap) {
      // 近すぎる。高いほうだけ残す。
      if (values[i] > values[last]) found[found.length - 1] = i;
      continue;
    }
    found.push(i);
  }

  return found;
}

/**
 * 進行方向。
 *
 * **腰の動きでは決めない。** トレッドミルだと腰が横に動かないので判定できない。
 * つま先とかかとの向き（つま先が前）で決める。これは走る場所に左右されない。
 */
export function facingOf(frames: readonly Frame[]): 1 | -1 {
  let sum = 0;
  for (const frame of frames) {
    for (const [heel, toe] of [
      [LM.leftHeel, LM.leftToe],
      [LM.rightHeel, LM.rightToe],
    ]) {
      const h = frame.points[heel];
      const t = frame.points[toe];
      if (!h || !t) continue;
      if ((h.visibility ?? 0) < SEEN || (t.visibility ?? 0) < SEEN) continue;
      sum += t.x - h.x;
    }
  }
  return sum >= 0 ? 1 : -1;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** その側の点が、通して見えているコマの割合。 */
function coverage(frames: readonly Frame[], indices: readonly number[]): number {
  const ok = frames.filter((frame) =>
    indices.every((i) => (frame.points[i]?.visibility ?? 0) >= SEEN),
  ).length;
  return frames.length > 0 ? ok / frames.length : 0;
}

/**
 * 片脚ぶんの接地を拾う。
 * 足首がいちばん下に来たコマ＝接地しているコマ、とみなす。
 * （画面の座標は下へ行くほど y が大きいので、y の山を探す）
 */
function contactsFor(
  frames: readonly Frame[],
  side: 'left' | 'right',
  facing: 1 | -1,
  minGap: number,
): Contact[] {
  const ankleIndex = side === 'left' ? LM.leftAnkle : LM.rightAnkle;
  const hipIndex = side === 'left' ? LM.leftHip : LM.rightHip;
  const kneeIndex = side === 'left' ? LM.leftKnee : LM.rightKnee;
  const shoulderIndex = side === 'left' ? LM.leftShoulder : LM.rightShoulder;

  const ankleY = smooth(frames.map((frame) => frame.points[ankleIndex]?.y ?? 0));

  /**
   * **いちばん下まで降りていない山は、接地ではない。**
   * 足を振り出す途中にも小さな山はできる。それを数えると、ピッチが実際より速く出る。
   * その足の上下幅の、下から3割の中にある山だけを接地とみなす。
   */
  const low = Math.min(...ankleY);
  const high = Math.max(...ankleY);
  const floor = low + (high - low) * 0.7;

  return peaks(ankleY, minGap)
    .filter((index) => ankleY[index] >= floor)
    .map((index): Contact | null => {
      const points = frames[index].points;
      const ankle = points[ankleIndex];
      const hip = points[hipIndex];
      const knee = points[kneeIndex];
      const shoulder = points[shoulderIndex];
      if (!ankle || !hip || !knee || !shoulder) return null;
      if ([ankle, hip, knee, shoulder].some((p) => (p.visibility ?? 0) < SEEN)) return null;

      const leg = distance(hip, ankle);
      if (leg <= 0) return null;

      // 体幹の前傾。腰から肩へのベクトルが、まっすぐ上からどれだけ倒れているか。
      const dx = shoulder.x - hip.x;
      const dy = hip.y - shoulder.y; // 上向きを正にする
      const lean = (Math.atan2(dx * facing, Math.max(dy, 1e-6)) * 180) / Math.PI;

      return {
        index,
        t: frames[index].t,
        side,
        ahead: ((ankle.x - hip.x) * facing) / leg,
        knee: angleAt(hip, knee, ankle),
        lean,
      };
    })
    .filter((contact): contact is Contact => contact !== null);
}

/** 腰の上下動。脚の長さで割って、写り方の大小に左右されないようにする。 */
function bounceOf(frames: readonly Frame[]): number | undefined {
  const heights: number[] = [];
  const legs: number[] = [];

  for (const frame of frames) {
    const left = frame.points[LM.leftHip];
    const right = frame.points[LM.rightHip];
    const ankle = frame.points[LM.leftAnkle] ?? frame.points[LM.rightAnkle];
    if (!left || !right || !ankle) continue;
    if ((left.visibility ?? 0) < SEEN || (right.visibility ?? 0) < SEEN) continue;

    const hipY = (left.y + right.y) / 2;
    heights.push(hipY);
    legs.push(distance({ x: (left.x + right.x) / 2, y: hipY }, ankle));
  }

  if (heights.length < 4) return undefined;
  const leg = mean(legs.filter((value) => value > 0));
  if (!(leg > 0)) return undefined;

  return (Math.max(...heights) - Math.min(...heights)) / leg;
}

export function analyzeGait(frames: readonly Frame[]): GaitReport {
  const facing = facingOf(frames);
  const empty: GaitReport = { measured: false, contacts: [], facing };

  if (frames.length < 8) {
    return { ...empty, note: 'コマ数が足りません。もう少し長く撮ってください' };
  }

  // 片側が隠れていないか。横から撮れていれば、片側はよく見えている。
  const leftSeen = coverage(frames, [LM.leftHip, LM.leftKnee, LM.leftAnkle]);
  const rightSeen = coverage(frames, [LM.rightHip, LM.rightKnee, LM.rightAnkle]);
  if (Math.max(leftSeen, rightSeen) < 0.5) {
    return { ...empty, note: '全身がうつっていません。もう少し引いて撮ってください' };
  }

  // 一歩の間隔は、速くても0.25秒はある。コマ数に直して、山の最小間隔にする。
  const span = frames[frames.length - 1].t - frames[0].t;
  const fps = span > 0 ? (frames.length - 1) / span : 30;
  const minGap = Math.max(2, Math.round(fps * 0.25));

  const contacts = [
    ...contactsFor(frames, 'left', facing, minGap),
    ...contactsFor(frames, 'right', facing, minGap),
  ].sort((a, b) => a.t - b.t);

  if (contacts.length < MIN_CONTACTS) {
    return {
      ...empty,
      contacts,
      note: '接地を見つけられませんでした。横から、全身がうつるように撮ってください',
    };
  }

  // ピッチ。接地から接地までの間隔から出す。
  const gaps: number[] = [];
  for (let i = 1; i < contacts.length; i += 1) {
    const gap = contacts[i].t - contacts[i - 1].t;
    // 同じ一歩を左右で二重に拾った時に、ピッチが跳ね上がらないようにする。
    if (gap > 0.12) gaps.push(gap);
  }

  return {
    measured: true,
    contacts,
    facing,
    cadence: gaps.length > 0 ? Math.round(60 / mean(gaps)) : undefined,
    bounce: bounceOf(frames),
    ahead: mean(contacts.map((contact) => contact.ahead)),
    knee: mean(contacts.map((contact) => contact.knee)),
    lean: mean(contacts.map((contact) => contact.lean)),
  };
}

/**
 * 測った数字を、コーチに渡す文章にする。
 *
 * **良し悪しは書かない。** 接地の位置も体幹の角度も、速度と体の作りで変わる。
 * 一般的な「良い数値」を当てはめると、その人にとって正しい動きを直させることになる。
 * 数字と、どう測ったかだけを渡して、言葉にするのはコーチに任せる。
 */
export function describeGait(report: GaitReport): string {
  if (!report.measured) return report.note ?? '測れませんでした。';

  const lines = [
    `接地は ${report.contacts.length} 回ぶん測った。`,
    report.cadence !== undefined ? `ピッチ: 約${report.cadence} spm。` : null,
    report.ahead !== undefined
      ? `接地位置: 腰の真下から前へ 脚の長さの${Math.round(report.ahead * 100)}%。` +
        '（0に近いほど体の真下で着いている。速く走るほど前になるのが普通）'
      : null,
    report.knee !== undefined
      ? `接地時の膝の角度: ${Math.round(report.knee)}度。（180度が伸びきり）`
      : null,
    report.lean !== undefined
      ? `体幹の前傾: ${Math.round(report.lean)}度。（正が進行方向へ倒れている）`
      : null,
    report.bounce !== undefined
      ? `上下動: 脚の長さの${Math.round(report.bounce * 100)}%。`
      : null,
    '',
    '**一般的な「良い数値」を当てはめないこと。** 接地の位置も体幹の角度も、',
    '走る速度と体の作りで変わる。この人の過去の測定と比べて話すこと。',
    '初回なら、数字の意味を説明するだけにとどめ、直す指示は出さないこと。',
    '横から撮れていない動画では、角度そのものがずれる。断定しないこと。',
  ];

  return lines.filter((line): line is string => line !== null).join('\n');
}
