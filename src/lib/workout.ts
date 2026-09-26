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

import type { ActivityLap, ActivityLog, ActivitySeries, ActivityType, RunnerProfile } from './types';
import { formatPace } from './goals';
import { coachDate } from './day';
import { addActivity, addShoeDistance, upgradeActivity } from './profile';
import { attributeRun } from './shoes';

/** どこから来た練習か。 */
export type WorkoutSource = 'health' | 'file';

/**
 * 走っている途中の1点。
 * **平均では消える情報がここにある。** 同じ平均心拍でも、
 * 前半で上がりきった走りと、最後まで上がらなかった走りは別物。
 */
export interface WorkoutSample {
  /** 開始からの経過秒。 */
  t: number;
  /** 開始からの累計距離(m)。 */
  d?: number;
  hr?: number;
  /** ピッチの生値。 */
  cadence?: number;
}

/**
 * フォームの指標。FIT ファイルからのみ入ってくる。
 * 単位はこの時点で揃えてある（cm・ms・W・%）。
 */
export interface RunningDynamics {
  powerW?: number;
  verticalOscillationCm?: number;
  groundContactMs?: number;
  /** 接地時間の左右バランス（左の割合 %）。 */
  balanceLeft?: number;
  verticalRatio?: number;
  stepLengthCm?: number;
}

/** ラップ1本ぶん（時計が区切ったもの）。 */
export interface WorkoutLap extends RunningDynamics {
  distanceM: number;
  durationSec: number;
  avgHr?: number;
  maxHr?: number;
  /** ピッチの生値。 */
  cadence?: number;
}

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
  /** 時計が区切ったラップ。無ければ、推移から1kmごとに切り出す。 */
  laps?: WorkoutLap[];
  /** 走行中の推移。間引く前の生の点で渡してよい。 */
  samples?: WorkoutSample[];
  /** フォームの指標（練習全体の平均）。FIT からのみ。 */
  dynamics?: RunningDynamics;
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


/**
 * 推移を残す本数。
 *
 * 記録は毎回ブラウザまで運ばれる。全部の練習に推移を持たせると、
 * 半年で目に見えて重くなる。**ラップは全部残す**（軽い上に、後から効く）。
 * 細かい推移が要るのは、直近の数本を見返す時だけ。
 */
export const KEEP_SERIES = 12;

/** 区間の心拍とピッチをまとめる。測れていない点は数に入れない。 */
function segmentStats(points: WorkoutSample[]): Pick<WorkoutLap, 'avgHr' | 'maxHr' | 'cadence'> {
  let hrSum = 0;
  let hrCount = 0;
  let maxHr: number | undefined;
  let cadenceSum = 0;
  let cadenceCount = 0;

  for (const point of points) {
    if (point.hr !== undefined) {
      hrSum += point.hr;
      hrCount += 1;
      maxHr = Math.max(maxHr ?? 0, point.hr);
    }
    if (point.cadence !== undefined) {
      cadenceSum += point.cadence;
      cadenceCount += 1;
    }
  }

  return {
    avgHr: hrCount > 0 ? hrSum / hrCount : undefined,
    maxHr,
    cadence: cadenceCount > 0 ? cadenceSum / cadenceCount : undefined,
  };
}

/**
 * ラップが無いファイル（GPX など）のために、1kmごとに区切る。
 *
 * **ここを作らないと、推移があってもコーチが読める形にならない。**
 * 「5km目で心拍が上がり始めた」は、区間に切って初めて言葉にできる。
 */
export function autoSplits(samples: WorkoutSample[], everyM = 1000): WorkoutLap[] {
  const points = samples.filter((point) => typeof point.d === 'number');
  if (points.length < 2) return [];

  const laps: WorkoutLap[] = [];
  const cut = (from: number, to: number) => {
    const segment = points.slice(from, to + 1);
    const distanceM = (segment[segment.length - 1].d ?? 0) - (segment[0].d ?? 0);
    const durationSec = segment[segment.length - 1].t - segment[0].t;
    if (distanceM > 0 && durationSec > 0) {
      laps.push({ distanceM, durationSec, ...segmentStats(segment) });
    }
  };

  let start = 0;
  let mark = everyM;
  for (let i = 1; i < points.length; i += 1) {
    const d = points[i].d ?? 0;
    if (d < mark) continue;
    cut(start, i);
    start = i;
    // GPS が飛んで一気に進んだ時も、次の区切りがずれないようにする。
    mark = (Math.floor(d / everyM) + 1) * everyM;
  }
  // 端数（最後の半端な区間）も落とさない。そこで垂れたかどうかが見たい。
  if (start < points.length - 1) cut(start, points.length - 1);

  return laps;
}

/** 走っている間の推移。点が多すぎると保存も表示も重くなるので、等間隔で間引く。 */
export const MAX_SERIES_POINTS = 240;

export function downsample(samples: WorkoutSample[], max = MAX_SERIES_POINTS): ActivitySeries | undefined {
  const points = samples.filter((point) => point.hr !== undefined || point.d !== undefined);
  if (points.length < 2) return undefined;

  const step = Math.max(1, Math.ceil(points.length / max));
  const t: number[] = [];
  const km: number[] = [];
  const hr: (number | null)[] = [];

  for (let i = 0; i < points.length; i += step) {
    const point = points[i];
    t.push(point.t);
    km.push(Math.round(((point.d ?? 0) / 1000) * 1000) / 1000);
    hr.push(point.hr !== undefined ? Math.round(point.hr) : null);
  }
  // 最後の点は必ず残す。終盤がどうだったかが、いちばん知りたいところ。
  const last = points[points.length - 1];
  if (t[t.length - 1] !== last.t) {
    t.push(last.t);
    km.push(Math.round(((last.d ?? 0) / 1000) * 1000) / 1000);
    hr.push(last.hr !== undefined ? Math.round(last.hr) : null);
  }

  return { t, km, hr };
}

/** 点を等間隔に間引く。最後の点は必ず残す（終盤がいちばん知りたいところ）。 */
export function thin(samples: WorkoutSample[], max = MAX_SERIES_POINTS): WorkoutSample[] {
  if (samples.length <= max) return samples;
  const step = Math.ceil(samples.length / max);
  const kept = samples.filter((_, index) => index % step === 0);
  const last = samples[samples.length - 1];
  if (kept[kept.length - 1]?.t !== last.t) kept.push(last);
  return kept;
}

/** 1本の練習で送るラップの上限。ウルトラでも足りる幅。 */
export const MAX_LAPS = 200;

/**
 * 送る前に軽くする。
 *
 * 1時間のロング走は1秒ごとに数千点あり、そのまま送ると受信の上限に当たる。
 * **区間は全部残し、細かい推移は間引く。** 区間は軽い上に、後から効くため。
 * まとめて取り込む時は、古い練習の推移を落とす（どのみち保存側でも落とす）。
 */
export function prepareForTransport(workouts: ImportedWorkout[]): ImportedWorkout[] {
  const ordered = [...workouts].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const keepFrom = Math.max(0, ordered.length - KEEP_SERIES);

  return ordered.map((workout, index) => {
    const laps =
      workout.laps && workout.laps.length > 1
        ? workout.laps.slice(0, MAX_LAPS)
        : workout.samples
          ? autoSplits(workout.samples).slice(0, MAX_LAPS)
          : undefined;

    return {
      ...workout,
      laps,
      samples: index >= keepFrom && workout.samples ? thin(workout.samples) : undefined,
    };
  });
}

/** 生のラップを、画面とコーチが読める形に直す。 */
export function toLaps(raw: WorkoutLap[]): ActivityLap[] {
  return raw
    .filter((lap) => lap.distanceM > 0 && lap.durationSec > 0)
    .map((lap, index) => ({
      index: index + 1,
      distanceKm: Math.round((lap.distanceM / 1000) * 100) / 100,
      durationSec: Math.round(lap.durationSec),
      pace: formatPace(lap.durationSec / (lap.distanceM / 1000)),
      avgHr: hr(lap.avgHr),
      maxHr: hr(lap.maxHr),
      cadence: normalizeCadence(lap.cadence),
      powerW: lap.powerW,
      verticalOscillationCm: lap.verticalOscillationCm,
      groundContactMs: lap.groundContactMs,
    }));
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
    // フォームの指標は、入っていれば足す。無い時は項目ごと出さない。
    ...(workout.dynamics ?? {}),
  };
  const hasMetrics = Object.values(metrics).some((value) => value !== undefined);

  // 時計がラップを切っていればそれを使う。無ければ推移から1kmごとに切り出す。
  const rawLaps =
    workout.laps && workout.laps.length > 1
      ? workout.laps
      : workout.samples
        ? autoSplits(workout.samples)
        : [];
  const laps = toLaps(rawLaps);

  return {
    date,
    type: workout.type,
    session: workout.name,
    distanceKm,
    durationMin,
    metrics: hasMetrics ? metrics : undefined,
    source: workout.source,
    externalId: workout.externalId,
    laps: laps.length > 1 ? laps : undefined,
    series: workout.samples ? downsample(workout.samples) : undefined,
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

function trimSeries(profile: RunnerProfile): RunnerProfile {
  const withSeries = profile.activities.filter((activity) => activity.series);
  if (withSeries.length <= KEEP_SERIES) return profile;

  const keep = new Set(withSeries.slice(-KEEP_SERIES).map((activity) => activity.id));
  return {
    ...profile,
    activities: profile.activities.map((activity) =>
      activity.series && !keep.has(activity.id) ? { ...activity, series: undefined } : activity,
    ),
  };
}

export interface ImportResult {
  profile: RunnerProfile;
  imported: number;
  /** すでに持っていて飛ばした数。 */
  skipped: number;
  /** すでにある記録を、より詳しい内容に差し替えた数。 */
  upgraded: number;
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
  let upgraded = 0;

  // 古い順に入れる。
  const ordered = [...workouts].sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  for (const workout of ordered) {
    const mapped = toActivity(workout);
    if (!mapped) continue;

    // すでに持っている練習か。元IDが同じもの、または別の入口から来た同じ練習。
    const existing =
      (mapped.externalId && known.has(mapped.externalId)
        ? next.activities.find((activity) => activity.externalId === mapped.externalId)
        : undefined) ?? next.activities.find((activity) => isSameWorkout(activity, mapped));

    if (existing) {
      // **弾く前に、どちらが詳しいかを見る。**
      // チャットで話した練習を後からファイルで取り込むと、後から来たほうが詳しい。
      // 弾いてしまうと、区間も心拍の推移も永久に失われる。
      const better =
        (mapped.laps?.length ?? 0) > (existing.laps?.length ?? 0) ||
        (Boolean(mapped.series) && !existing.series) ||
        (Boolean(mapped.metrics?.groundContactMs) && !existing.metrics?.groundContactMs);

      if (better) {
        next = upgradeActivity(next, existing.id, mapped, now);
        if (mapped.externalId) known.add(mapped.externalId);
        upgraded += 1;
      } else {
        skipped += 1;
      }
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

  return { profile: trimSeries(next), imported, skipped, upgraded };
}

/** 取り込んだ結果を、そのまま画面に出せる一文にする。 */
export function describeImport(
  result: Pick<ImportResult, 'imported' | 'skipped' | 'upgraded'>,
): string {
  const parts: string[] = [];
  if (result.imported > 0) parts.push(`${result.imported}件の練習を取り込みました`);
  // 「差し替えた」は、黙っていると何も起きていないように見える。必ず言う。
  if (result.upgraded > 0) parts.push(`${result.upgraded}件は、より詳しい記録に差し替えました`);

  if (parts.length === 0) {
    return result.skipped > 0
      ? 'すべて取り込み済みでした。新しい練習はありません。'
      : '取り込める練習が見つかりませんでした。';
  }
  if (result.skipped > 0) parts.push(`${result.skipped}件はすでに入っていました`);
  return `${parts.join('。')}。`;
}
