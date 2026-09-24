/**
 * 積み上げたものを見せる層。
 *
 * ここが薄いと、記録は「入れているだけ」になります。
 * **人を引き留めるのは、賢い返答ではなく自分の履歴です。**
 * 半年分の練習と、痛みの経過と、靴の距離は、時間でしか作れない。
 *
 * 計算はすべてここで行い、画面は描くだけにしています。
 * グラフの数字がモデルの気分で変わってはいけないので。
 */

import type { ActivityLog, RunnerProfile } from './types';
import { parseDuration } from './goals';

const DAY_MS = 86_400_000;

export interface MonthBar {
  /** "2026-09" */
  month: string;
  /** "9月" */
  label: string;
  km: number;
  runs: number;
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function monthLabel(key: string): string {
  const month = Number(key.slice(5, 7));
  return `${month}月`;
}

/** 直近 months か月の走行距離。記録の無い月も0として並べる（途切れも情報なので）。 */
export function monthlyVolume(
  profile: RunnerProfile,
  months = 6,
  now: Date = new Date(),
): MonthBar[] {
  const keys: string[] = [];
  for (let back = months - 1; back >= 0; back -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - back, 1);
    keys.push(`${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}`);
  }

  const bars = new Map(keys.map((key) => [key, { month: key, label: monthLabel(key), km: 0, runs: 0 }]));
  for (const activity of profile.activities ?? []) {
    const bar = bars.get(monthKey(activity.date));
    if (!bar) continue;
    if (activity.distanceKm) bar.km += activity.distanceKm;
    if (activity.type === 'run') bar.runs += 1;
  }

  return [...bars.values()].map((bar) => ({ ...bar, km: Math.round(bar.km) }));
}

export interface WeightPoint {
  date: string;
  kg: number;
}

/** はかった体重の並び。増減を責めるためではなく、線が続いていること自体を見せる。 */
export function weightTrend(profile: RunnerProfile, days = 90, now: Date = new Date()): WeightPoint[] {
  const from = now.getTime() - days * DAY_MS;
  return (profile.dailyLog ?? [])
    .filter((record) => record.weightKg !== undefined && Date.parse(`${record.date}T12:00:00`) >= from)
    .map((record) => ({ date: record.date, kg: record.weightKg as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface PacePoint {
  date: string;
  /** 秒/km。 */
  secondsPerKm: number;
  km: number;
}

function paceSeconds(activity: ActivityLog): number | undefined {
  const raw = activity.metrics?.avgPace;
  if (raw) {
    const parsed = parseDuration(raw.replace(/\s*\/\s*km$/i, ''));
    if (parsed !== undefined && parsed > 0) return parsed;
  }
  if (activity.distanceKm && activity.durationMin) {
    return (activity.durationMin * 60) / activity.distanceKm;
  }
  return undefined;
}

/**
 * ペースの移り変わり。
 * 距離の短い練習まで混ぜると、流しやウォームアップで線が暴れる。
 */
export function paceTrend(
  profile: RunnerProfile,
  options: { days?: number; minKm?: number; now?: Date } = {},
): PacePoint[] {
  const { days = 180, minKm = 5, now = new Date() } = options;
  const from = now.getTime() - days * DAY_MS;

  return (profile.activities ?? [])
    .filter(
      (activity) =>
        activity.type === 'run' &&
        (activity.distanceKm ?? 0) >= minKm &&
        Date.parse(`${activity.date}T12:00:00`) >= from,
    )
    .map((activity) => ({
      date: activity.date,
      secondsPerKm: paceSeconds(activity) ?? 0,
      km: activity.distanceKm ?? 0,
    }))
    .filter((point) => point.secondsPerKm > 120 && point.secondsPerKm < 900)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface WeeklyPace {
  /** その週の月曜日 YYYY-MM-DD。 */
  weekStart: string;
  secondsPerKm: number;
  runs: number;
}

/** その日が属する週の月曜日。 */
function weekStartOf(date: string): string {
  const time = Date.parse(`${date}T12:00:00`);
  const day = new Date(time).getDay();
  // 日曜(0)は前の週の終わりとして扱う。週の始まりを月曜に揃える。
  const back = day === 0 ? 6 : day - 1;
  return new Date(time - back * DAY_MS).toISOString().slice(0, 10);
}

/**
 * 週ごとの平均ペース。
 *
 * 1本ずつ並べると、ポイント練習とイージーが交互に来るので線が鋸の歯になり、
 * **見たいはずの流れがまったく読めません。** 週でならすと、そこが見えてきます。
 */
export function weeklyPace(
  profile: RunnerProfile,
  options: { weeks?: number; minKm?: number; now?: Date } = {},
): WeeklyPace[] {
  const { weeks = 12, minKm = 5, now = new Date() } = options;
  const points = paceTrend(profile, { days: weeks * 7, minKm, now });

  const buckets = new Map<string, number[]>();
  for (const point of points) {
    const key = weekStartOf(point.date);
    buckets.set(key, [...(buckets.get(key) ?? []), point.secondsPerKm]);
  }

  return [...buckets.entries()]
    .map(([weekStart, values]) => ({
      weekStart,
      secondsPerKm: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
      runs: values.length,
    }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

export interface Totals {
  /** 記録が始まった日。 */
  since?: string;
  days: number;
  runs: number;
  km: number;
  hours: number;
  /** 記録した日数（走った日だけでなく、体調を書いた日も含む）。 */
  loggedDays: number;
}

/** 積み上げの総量。ここが「失いたくないもの」の正体。 */
export function totals(profile: RunnerProfile, now: Date = new Date()): Totals {
  const activities = profile.activities ?? [];
  const dates = [
    ...activities.map((activity) => activity.date),
    ...(profile.conditionLogs ?? []).map((log) => log.date),
    ...(profile.dailyLog ?? []).map((record) => record.date),
  ].filter(Boolean);

  const since = dates.length > 0 ? dates.reduce((min, date) => (date < min ? date : min)) : undefined;
  const runs = activities.filter((activity) => activity.type === 'run');

  return {
    since,
    days: since ? Math.max(1, Math.round((now.getTime() - Date.parse(`${since}T12:00:00`)) / DAY_MS)) : 0,
    runs: runs.length,
    km: Math.round(runs.reduce((sum, activity) => sum + (activity.distanceKm ?? 0), 0)),
    // 100時間を超えたら小数は意味を持たない。桁が増えるほど読みにくくなるだけ。
    hours: (() => {
      const raw = activities.reduce((sum, activity) => sum + (activity.durationMin ?? 0), 0) / 60;
      return raw >= 10 ? Math.round(raw) : Math.round(raw * 10) / 10;
    })(),
    loggedDays: new Set(dates).size,
  };
}

export interface Comparison {
  label: string;
  /** 直近4週。 */
  recent: number;
  /** その前の4週。 */
  previous: number;
  /** 増減（％）。前が0なら undefined。 */
  changePercent?: number;
  unit: string;
  /** 増えた方が良い指標か。ペースは「小さいほど速い」ので逆になる。 */
  higherIsBetter: boolean;
}

function windowOf(profile: RunnerProfile, from: number, to: number): ActivityLog[] {
  return (profile.activities ?? []).filter((activity) => {
    const time = Date.parse(`${activity.date}T12:00:00`);
    return time >= from && time < to;
  });
}

function change(recent: number, previous: number): number | undefined {
  if (!(previous > 0)) return undefined;
  return Math.round(((recent - previous) / previous) * 100);
}

/**
 * 直近4週と、その前の4週。
 * 「先月より良くなっているか」は、週単位の揺れに埋もれて自分では見えない。
 */
export function fourWeekComparison(profile: RunnerProfile, now: Date = new Date()): Comparison[] {
  const end = now.getTime();
  const mid = end - 28 * DAY_MS;
  const start = end - 56 * DAY_MS;

  const recent = windowOf(profile, mid, end + DAY_MS);
  const previous = windowOf(profile, start, mid);

  const km = (list: ActivityLog[]) =>
    Math.round(list.reduce((sum, activity) => sum + (activity.distanceKm ?? 0), 0));
  const sessions = (list: ActivityLog[]) => list.filter((activity) => Boolean(activity.session)).length;
  const easyPace = (list: ActivityLog[]) => {
    const paces = list
      .filter((activity) => activity.type === 'run' && (activity.distanceKm ?? 0) >= 5)
      .map((activity) => paceSeconds(activity))
      .filter((seconds): seconds is number => seconds !== undefined);
    if (paces.length === 0) return 0;
    return Math.round(paces.reduce((sum, value) => sum + value, 0) / paces.length);
  };

  return [
    {
      label: '走行距離',
      recent: km(recent),
      previous: km(previous),
      changePercent: change(km(recent), km(previous)),
      unit: 'km',
      higherIsBetter: true,
    },
    {
      label: 'ポイント練習',
      recent: sessions(recent),
      previous: sessions(previous),
      changePercent: change(sessions(recent), sessions(previous)),
      unit: '回',
      higherIsBetter: true,
    },
    {
      label: '平均ペース',
      recent: easyPace(recent),
      previous: easyPace(previous),
      changePercent: change(easyPace(recent), easyPace(previous)),
      unit: '/km',
      higherIsBetter: false,
    },
  ];
}

export interface PainSpan {
  site: string;
  since?: string;
  until?: string;
  resolved: boolean;
  days?: number;
}

/** 痛みの履歴。「あの時ちゃんと止めた」が見えると、次に止める判断がしやすくなる。 */
export function painHistory(profile: RunnerProfile, now: Date = new Date()): PainSpan[] {
  return (profile.pains ?? [])
    .map((pain) => {
      const since = pain.since;
      const until = pain.status === 'resolved' ? pain.updatedAt.slice(0, 10) : undefined;
      const from = since ? Date.parse(`${since}T12:00:00`) : undefined;
      const to = until ? Date.parse(`${until}T12:00:00`) : now.getTime();
      return {
        site: pain.site,
        since,
        until,
        resolved: pain.status === 'resolved',
        days: from !== undefined ? Math.max(1, Math.round((to - from) / DAY_MS)) : undefined,
      };
    })
    .sort((a, b) => (b.since ?? '').localeCompare(a.since ?? ''));
}

/** 秒/km を "4:15" の形に。グラフの軸に出すので単位は付けない。 */
export function paceLabel(secondsPerKm: number): string {
  const total = Math.round(secondsPerKm);
  return `${Math.floor(total / 60)}:${`${total % 60}`.padStart(2, '0')}`;
}
