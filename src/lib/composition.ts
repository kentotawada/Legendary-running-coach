/**
 * 体組成。脂肪と、それ以外。
 *
 * **同じ「3kg減」でも、中身が正反対のことがある。**
 *
 *     3kg減のうち 脂肪2.4kg・除脂肪0.6kg … いい減り方
 *     3kg減のうち 脂肪1.0kg・除脂肪2.0kg … 危ない減り方
 *
 * 体重だけを見ていると、この2つが同じ数字に見える。走る人にとって
 * 後者は、筋肉と骨が落ちていく入口で、疲労骨折と貧血につながる。
 * **減る速さだけを見張っていても、ここは拾えない。**
 *
 * ただし、家庭用の体組成計の絶対値は信用しない。DEXA に対して
 * ±3〜10ポイントずれ、**脱水で1〜3ポイント高く出る**。
 * 走った直後に乗れば脱水しているので、そのまま使うと
 * 「走るほど体脂肪が増える」というグラフができあがる。
 *
 * **だから、見るのは向きだけ。** 「体脂肪率を◯%まで落とす」のような
 * 目標は、この数字では立てられないし、立てさせない。
 */

import type { DailyRecord, RunnerProfile } from './types';

/** これより下は、走る人にとって健康な体重ではない（BMI）。 */
export const MIN_HEALTHY_BMI = 18.5;

/** 体脂肪率として受け取る範囲。外は入力か読み取りの誤り。 */
export const MIN_BODY_FAT = 3;
export const MAX_BODY_FAT = 60;

/** 身長として受け取る範囲。 */
export const MIN_HEIGHT_CM = 100;
export const MAX_HEIGHT_CM = 250;

export function isBodyFatInRange(percent: number | undefined): percent is number {
  return (
    percent !== undefined &&
    Number.isFinite(percent) &&
    percent >= MIN_BODY_FAT &&
    percent <= MAX_BODY_FAT
  );
}

export function isHeightInRange(cm: number | undefined): cm is number {
  return cm !== undefined && Number.isFinite(cm) && cm >= MIN_HEIGHT_CM && cm <= MAX_HEIGHT_CM;
}

/** 脂肪の重さ(kg)。 */
export function fatMassKg(weightKg: number, bodyFatPercent: number): number {
  return (weightKg * bodyFatPercent) / 100;
}

/** 脂肪以外の重さ(kg)。筋肉・骨・水分をまとめたもの。 */
export function leanMassKg(weightKg: number, bodyFatPercent: number): number {
  return weightKg - fatMassKg(weightKg, bodyFatPercent);
}

/** BMI。身長が無ければ null。 */
export function bmiOf(weightKg: number, heightCm: number | undefined): number | null {
  if (!isHeightInRange(heightCm) || weightKg <= 0) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

/**
 * 健康の下限の体重(kg)。
 *
 * **身長があれば、ここで止める。** 身長が無い時は、呼ぶ側が
 * 「いまの体重の◯%」という粗い下限に落とす。
 */
export function minHealthyWeightKg(heightCm: number | undefined): number | null {
  if (!isHeightInRange(heightCm)) return null;
  const m = heightCm / 100;
  return Math.round(MIN_HEALTHY_BMI * m * m * 10) / 10;
}

/** 減り方の見立て。 */
export type LossKind =
  /** 脂肪が主に減っている。いい減り方。 */
  | 'fat'
  /** 脂肪も除脂肪も減っている。 */
  | 'mixed'
  /** 除脂肪が主に減っている。**ここが危ない。** */
  | 'lean'
  /** 増えている。 */
  | 'gain'
  /** ほとんど変わっていない。 */
  | 'flat';

export interface CompositionChange {
  /** 比べた最初と最後の日。 */
  from: string;
  to: string;
  days: number;
  weightKg: number;
  /** 脂肪の増減(kg)。負なら減った。 */
  fatKg: number;
  /** 除脂肪の増減(kg)。負なら減った。 */
  leanKg: number;
  kind: LossKind;
  /** 減ったぶんのうち、脂肪が占める割合(0〜1)。増えている時は null。 */
  fatShare: number | null;
}

/** 体重と体脂肪率が両方そろっている日だけ。 */
function usable(log: DailyRecord[]): { date: string; weightKg: number; fat: number }[] {
  return log
    .filter(
      (record): record is DailyRecord & { weightKg: number; bodyFatPercent: number } =>
        record.weightKg !== undefined && isBodyFatInRange(record.bodyFatPercent),
    )
    .map((record) => ({ date: record.date, weightKg: record.weightKg, fat: record.bodyFatPercent }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 何が減ったのか。
 *
 * **1日の値では比べない。** 体組成計は日によって2〜3ポイント振れるので、
 * 前後それぞれ数回ぶんをならしてから引く。そうしないと、
 * 測った日の体調で「筋肉が2kg減った」が出てしまう。
 */
export function compositionChange(
  profile: RunnerProfile | null | undefined,
  options: { days?: number; now?: Date } = {},
): CompositionChange | null {
  const { days = 90, now = new Date() } = options;
  const from = now.getTime() - days * 86_400_000;

  const points = usable(profile?.dailyLog ?? []).filter(
    (point) => Date.parse(`${point.date}T12:00:00`) >= from,
  );
  // 前後3回ずつならしたいので、最低6回。
  if (points.length < 6) return null;

  const span = Math.round(
    (Date.parse(`${points[points.length - 1]!.date}T12:00:00`) -
      Date.parse(`${points[0]!.date}T12:00:00`)) /
      86_400_000,
  );
  if (span < 21) return null;

  const take = Math.min(3, Math.floor(points.length / 2));
  const head = points.slice(0, take);
  const tail = points.slice(points.length - take);

  const mean = (list: typeof points, pick: (p: (typeof points)[number]) => number) =>
    list.reduce((sum, p) => sum + pick(p), 0) / list.length;

  const w0 = mean(head, (p) => p.weightKg);
  const w1 = mean(tail, (p) => p.weightKg);
  const f0 = fatMassKg(w0, mean(head, (p) => p.fat));
  const f1 = fatMassKg(w1, mean(tail, (p) => p.fat));
  const l0 = w0 - f0;
  const l1 = w1 - f1;

  const weightKg = round1(w1 - w0);
  const fatKg = round1(f1 - f0);
  const leanKg = round1(l1 - l0);

  return {
    from: points[0]!.date,
    to: points[points.length - 1]!.date,
    days: span,
    weightKg,
    fatKg,
    leanKg,
    kind: kindOf(weightKg, fatKg, leanKg),
    fatShare: weightKg < 0 ? clamp01(fatKg / weightKg) : null,
  };
}

function kindOf(weightKg: number, fatKg: number, leanKg: number): LossKind {
  // 体組成計の振れ幅を下回る変化は、変化として扱わない。
  if (Math.abs(weightKg) < 0.8) return 'flat';
  if (weightKg > 0) return 'gain';
  if (leanKg >= -0.3) return 'fat';
  // 減ったぶんの半分以上が除脂肪なら、危ない側として扱う。
  return leanKg < fatKg ? 'lean' : 'mixed';
}

/**
 * 減り方への一言。
 *
 * **「体脂肪率を◯%まで落とす」とは言わない。** 家庭用の体組成計の
 * 絶対値では、その目標は立てられない。言えるのは向きだけ。
 */
export function describeChange(change: CompositionChange): { title: string; detail: string } {
  const lost = Math.abs(change.weightKg);
  switch (change.kind) {
    case 'fat':
      return {
        title: '脂肪が中心に減っています',
        detail: `${change.days}日で ${lost}kg。そのうち脂肪が ${Math.abs(change.fatKg)}kg。走るための体は保てています。`,
      };
    case 'mixed':
      return {
        title: '脂肪と、それ以外の両方が減っています',
        detail: `${change.days}日で ${lost}kg。脂肪 ${Math.abs(change.fatKg)}kg、それ以外 ${Math.abs(change.leanKg)}kg。食べる量が足りているか、一度見てみてください。`,
      };
    case 'lean':
      return {
        title: '減っているのは、脂肪ではありません',
        detail: `${change.days}日で ${lost}kg 減っていますが、その多く（${Math.abs(change.leanKg)}kg）が筋肉や骨を含む脂肪以外です。走る人にとっては、疲労骨折と貧血の入口になります。食べる量と休む日を、コーチに相談してください。`,
      };
    case 'gain':
      return {
        title: '増えています',
        detail: `${change.days}日で ${change.weightKg}kg。そのうち脂肪以外が ${change.leanKg}kg。走り込んでいる時期なら、筋肉と水分が増えているところです。`,
      };
    case 'flat':
      return {
        title: 'ほとんど変わっていません',
        detail: `${change.days}日で ${change.weightKg}kg。体組成計の振れ幅の中です。`,
      };
  }
}

/** 測り方。**ここを外すと、何を見ても意味が無い。** */
export const MEASURE_NOTE =
  '体組成計は、朝起きてトイレのあと・食事の前・走る前に測ってください。走った直後は脱水で、体脂肪率が高めに出ます。絶対値ではなく、変わっていく向きを見ます。';

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}
