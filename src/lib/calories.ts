/**
 * 消費カロリーの目安。
 *
 * **コードで出す。モデルには絶対に計算させない。**
 * 「だいたい500kcalくらいです」と自信たっぷりに書かれた数字は、
 * 体重も時間も見ていない。ここは距離・時間・体重から、決まった式で出す。
 *
 * 使うのは運動生理学で広く使われている推定式（ACSM）。
 * 速さから酸素摂取量を出し、それを熱量に直す。
 *
 *     走る: VO2 = 0.2 × 速さ + 3.5
 *     歩く: VO2 = 0.1 × 速さ + 3.5      （速さは m/分、VO2 は ml/kg/分）
 *     kcal = VO2 ÷ 3.5 × 3.5 × 体重 × 分 ÷ 200
 *
 * **これは目安であって、実測ではない。** 同じ距離でも、気温・風・坂・
 * その人の走りの効率で1〜2割は変わる。画面でも必ず「目安」と書く。
 * 体重が分からない時は、**出さない。** 体重を仮に置いた数字は、
 * 当てずっぽうを数字の顔で出すことになる。
 */

import type { ActivityLog, ActivityType } from './types';

/**
 * 歩きと走りの境目（m/分）。
 *
 * 107 m/分 ＝ 時速 6.4km。ここを境に、使う式を変える。
 * 競歩のような速い歩きは走りの式のほうが近くなるので、速さで決める。
 */
const RUN_FROM = 107;

/** 安静時の酸素摂取量（ml/kg/分）。1 MET。 */
const REST_VO2 = 3.5;

/** これより遅い・速いものは、記録の読み違いとして扱う（m/分）。 */
const MIN_SPEED = 30; // 時速 1.8km。これ以下は止まっている
const MAX_SPEED = 400; // 時速 24km。世界記録級より速い

/** 体を動かした記録か。休養や柔軟にはカロリーを出さない。 */
export function burnsEnergy(type: ActivityType): boolean {
  return type === 'run' || type === 'walk' || type === 'cross';
}

/**
 * 1回ぶんの目安（kcal）。
 *
 * 出せない時は null を返す。**0 を返さない。**
 * 0 kcal は「動いていない」という意味になってしまい、
 * 「計算できていない」とは別のことを言うことになる。
 */
export function estimateCalories(
  activity: Pick<ActivityLog, 'type' | 'distanceKm' | 'durationMin'>,
  weightKg: number | undefined,
): number | null {
  if (!weightKg || weightKg <= 0 || !Number.isFinite(weightKg)) return null;
  if (!burnsEnergy(activity.type)) return null;

  const km = activity.distanceKm;
  const minutes = activity.durationMin;
  if (!km || !minutes || km <= 0 || minutes <= 0) return null;
  if (!Number.isFinite(km) || !Number.isFinite(minutes)) return null;

  const speed = (km * 1000) / minutes;
  if (speed < MIN_SPEED || speed > MAX_SPEED) return null;

  // 自転車など（cross）は走りの式が当てはまらない。歩きの式のほうが近い。
  const running = activity.type === 'run' && speed >= RUN_FROM;
  const vo2 = running ? 0.2 * speed + REST_VO2 : 0.1 * speed + REST_VO2;
  const kcal = (vo2 * weightKg * minutes) / 200;

  if (!Number.isFinite(kcal) || kcal <= 0) return null;
  // 1kcal 未満の端数に意味は無い。
  return Math.round(kcal);
}

/** まとめた目安。出せなかった分は飛ばす（0 として足さない）。 */
export function totalCalories(
  activities: Pick<ActivityLog, 'type' | 'distanceKm' | 'durationMin'>[],
  weightKg: number | undefined,
): number | null {
  const each = activities
    .map((activity) => estimateCalories(activity, weightKg))
    .filter((value): value is number => value !== null);
  if (each.length === 0) return null;
  return each.reduce((sum, value) => sum + value, 0);
}

/**
 * なぜ出せないのか。
 *
 * **「—」だけを出さない。** 数字が出ない時に理由が無いと、
 * 壊れているのか、自分が何かしていないのか分からない。
 */
export function whyNoCalories(
  activity: Pick<ActivityLog, 'type' | 'distanceKm' | 'durationMin'>,
  weightKg: number | undefined,
): string | null {
  if (!burnsEnergy(activity.type)) return null;
  if (!weightKg || weightKg <= 0) return '体重を記録すると、消費カロリーの目安も出ます';
  if (!activity.distanceKm || !activity.durationMin) return '距離と時間がそろうと、目安を出せます';
  return null;
}

/** 画面に添える注意書き。**必ずどこかに出す。** */
export const CALORIES_NOTE =
  '体重と、走った距離・時間から出した目安です。気温・風・坂・走りの効率で1〜2割は変わります。';
