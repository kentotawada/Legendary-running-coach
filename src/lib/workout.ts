/**
 * 外から来た練習を、1つの形に揃えてカルテへ入れる層。
 *
 * 取り込み口は増えます。Strava、iPhone のヘルスケア、時計から書き出したファイル。
 * **入口ごとに取り込み処理を書くと、二重取り込みの防ぎ方や靴の積み方が入口ごとにずれます。**
 * ずれた瞬間、週の走行距離が狂い、指導そのものが狂う。
 * だから「正規化された1件」をここで定義して、どの入口もここを通します。
 *
 * ヘルスケア経由では、ラップもピッチも入ってこないことがあります。
 * **足りない項目は、埋めずに空のままにします。** 無い数字を作ると、評価がまるごと嘘になるからです。
 */

import type { ActivityLog, ActivityType, RunnerProfile } from './types';
import { formatPace } from './goals';
import { coachDate } from './day';
import { addActivity, addShoeDistance } from './profile';
import { attributeRun } from './shoes';

/** どこから来た練習か。 */
export type WorkoutSource = 'health' | 'file';

/**
 * 正規化された1件。
 * 単位は生のまま（メートル・秒）持ちます。丸めるのは最後の一箇所だけにするためです。
 */
export interface ImportedWorkout {
  /** 二重取り込みを防ぐための元ID。入口ごとに接頭辞を付ける（health: / file:）。 */
  externalId: string;
  /**
   * 走り始めた時刻（ISO）。
   *
   * **日付ではなく時刻を受け取る。** 書き出したファイルの時刻はたいてい UTC なので、
   * 先頭10文字を日付として使うと、日本の朝6時の練習が前日に入る。
   * 何日の練習かは、走る人の時刻で、このアプリの区切り（深夜2時）に合わせてこちらで決める。
   */
  startedAt: string;
  type: ActivityType;
  distanceM?: number;
  durationSec?: number;
  avgHr?: number;
  maxHr?: number;
  /**
   * ピッチの生値。
   * 片脚の回転数（約85）で来ることも、両脚のspm（約170）で来ることもある。
   * どちらかは送り手の都合なので、こちらで見分ける。
   */
  cadence?: number;
  elevationGainM?: number;
  /** 活動名。「Morning Run」のような自動命名は、呼び出し側が落としてから渡す。 */
  name?: string;
  source: WorkoutSource;
}

/**
 * ピッチを spm に揃える。
 *
 * 片脚の回転数で来る形式（Strava・一部のTCX）と、すでに spm の形式がある。
 * ランで spm が 120 を下回ることは現実にはほぼ無いので、そこを境にする。
 * **推測が外れると「ピッチが低すぎる」という誤った指導に直結する**ので、
 * 境目は控えめに（100や110ではなく120に）取る。
 */
export function normalizeCadence(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value < 120 ? value * 2 : value);
}

/** 正規化された1件を、カルテの記録に直す。距離も時間も無いものは入れない。 */
export function toActivity(workout: ImportedWorkout): Omit<ActivityLog, 'id' | 'createdAt'> | null {
  const started = new Date(workout.startedAt);
  if (Number.isNaN(started.getTime())) return null;
  const date = coachDate(started);

  const meters = workout.distanceM && workout.distanceM > 0 ? workout.distanceM : 0;
  const seconds = workout.durationSec && workout.durationSec > 0 ? workout.durationSec : 0;
  const distanceKm = meters > 0 ? Math.round((meters / 1000) * 100) / 100 : undefined;
  const durationMin = seconds > 0 ? Math.round(seconds / 60) : undefined;
  if (distanceKm === undefined && durationMin === undefined) return null;

  const onFoot = workout.type === 'run' || workout.type === 'walk';
  const spm = onFoot ? normalizeCadence(workout.cadence) : undefined;
  const avgPace =
    onFoot && meters > 0 && seconds > 0 ? formatPace(seconds / (meters / 1000)) : undefined;
  // ストライド = 1分あたりに進む距離 ÷ ピッチ。
  const strideM =
    spm && meters > 0 && seconds > 0
      ? Math.round((meters / (seconds / 60) / spm) * 100) / 100
      : undefined;

  const metrics = {
    avgPace,
    avgHr: hr(workout.avgHr),
    maxHr: hr(workout.maxHr),
    cadence: spm,
    strideM,
    elevationGainM:
      typeof workout.elevationGainM === 'number' && Number.isFinite(workout.elevationGainM)
        ? Math.round(workout.elevationGainM)
        : undefined,
  };
  const hasMetrics = Object.values(metrics).some((value) => value !== undefined);

  return {
    date,
    type: workout.type,
    session: workout.name,
    distanceKm,
    durationMin,
    metrics: hasMetrics ? metrics : undefined,
    source: workout.source,
    externalId: workout.externalId,
  };
}

/** 心拍は人の値。あり得ない数字は、取り込まずに落とす。 */
function hr(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  return rounded >= 30 && rounded <= 240 ? rounded : undefined;
}

/**
 * 同じ練習が、別の入口から二度入るのを防ぐ。
 *
 * ヘルスケアから入った1本と、同じ練習をファイルから入れた1本は、元IDが違うので素通りする。
 * そこで**日付・種目・距離・時間**で見て、ほぼ同じものは同じ練習とみなす。
 *
 * 幅は狭く取る。広げると「午前と午後に同じ距離を走った日」の片方が消え、
 * 週の走行距離が足りなくなる。二重に数えるのと同じくらい困る。
 */
const SAME_DISTANCE_KM = 0.3;
const SAME_DURATION_MIN = 2;

function isSameWorkout(
  existing: ActivityLog,
  candidate: Omit<ActivityLog, 'id' | 'createdAt'>,
): boolean {
  if (existing.date !== candidate.date || existing.type !== candidate.type) return false;

  // どちらかに距離が無ければ、同じものだと言い切れない。
  if (existing.distanceKm === undefined || candidate.distanceKm === undefined) return false;
  if (Math.abs(existing.distanceKm - candidate.distanceKm) > SAME_DISTANCE_KM) return false;

  if (existing.durationMin === undefined || candidate.durationMin === undefined) return true;
  return Math.abs(existing.durationMin - candidate.durationMin) <= SAME_DURATION_MIN;
}

export interface ImportResult {
  profile: RunnerProfile;
  imported: number;
  /** すでに持っていて飛ばした数。 */
  skipped: number;
}

/**
 * 正規化された練習を、カルテへ入れる。
 *
 * **同じ練習を二度入れない。** 週の走行距離がまるごと狂うため、ここが最優先。
 * 同じ取り込みの中に同じIDが2つあっても、1件だけ入れる。
 */
export function importWorkouts(
  profile: RunnerProfile,
  workouts: ImportedWorkout[],
  now: Date = new Date(),
): ImportResult {
  const known = new Set(
    profile.activities.map((activity) => activity.externalId).filter((id): id is string => Boolean(id)),
  );

  let next = profile;
  let imported = 0;
  let skipped = 0;

  // 古い順に入れる。並びが日付順になっていないと、直近の行動が読みにくくなる。
  const ordered = [...workouts].sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  for (const workout of ordered) {
    const mapped = toActivity(workout);
    if (!mapped) continue;
    if (mapped.externalId && known.has(mapped.externalId)) {
      skipped += 1;
      continue;
    }
    // 別の入口から入った同じ練習も、ここで止める。
    if (next.activities.some((activity) => isSameWorkout(activity, mapped))) {
      skipped += 1;
      continue;
    }

    next = addActivity(next, mapped, now);
    if (mapped.externalId) known.add(mapped.externalId);
    imported += 1;

    // 靴が1足しか無い時だけ、そこへ積む。
    // 2足以上あって、どれを履いたか分からない時に当てずっぽうで積まない。
    if (mapped.type === 'run' && mapped.distanceKm) {
      const guess = attributeRun(next, undefined);
      if (guess && !guess.externalId) next = addShoeDistance(next, guess.id, mapped.distanceKm, now);
    }
  }

  return { profile: next, imported, skipped };
}

/** 取り込んだ結果を、そのまま画面に出せる一文にする。 */
export function describeImport(result: ImportResult): string {
  if (result.imported === 0) {
    return result.skipped > 0
      ? 'すべて取り込み済みでした。新しい練習はありません。'
      : '取り込める練習が見つかりませんでした。';
  }
  const parts = [`${result.imported}件の練習を取り込みました`];
  if (result.skipped > 0) parts.push(`${result.skipped}件はすでに入っていました`);
  return `${parts.join('。')}。`;
}
