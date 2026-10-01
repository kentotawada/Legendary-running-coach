/**
 * ひと月を、1枚の表で見る。
 *
 * グラフは「どれだけ積んだか」を見せるが、**「どれだけ空いたか」は見せない。**
 * 3日空いた、1週間まるごと空いた、というのは棒グラフの谷として
 * 通り過ぎてしまう。走った日と走らなかった日を同じ大きさの枡で並べると、
 * 空白がそのまま空白として目に入る。
 *
 * 責めるための画面ではない。**自分の形が見える**ための画面で、
 * 「平日は無理で、土日だけ走っている」のような自分の癖は、
 * 数字をいくら並べても分からず、枡を並べて初めて見える。
 */

import { estimateCalories } from './calories';
import type { ActivityLog, ActivityType, RunnerProfile } from './types';

/** 週の始まりは月曜。review.ts の週の区切りと揃える。 */
export const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'] as const;

export interface CalendarDay {
  /** YYYY-MM-DD */
  date: string;
  /** 1〜31。 */
  day: number;
  /** その月の日か。前後の月から埋めた枡は false。 */
  inMonth: boolean;
  /** その日の合計(km)。 */
  km: number;
  /** その日の合計(分)。 */
  minutes: number;
  /** その日の目安(kcal)。出せなければ null。 */
  kcal: number | null;
  /** その日に何をしたか。並び順は記録順。 */
  types: ActivityType[];
  /** その日はかった体重。 */
  weightKg?: number;
  /** 痛みを抱えていた日か。 */
  pain: boolean;
  isToday: boolean;
  /** まだ来ていない日。空白の意味が違うので、分けて描く。 */
  isFuture: boolean;
}

export interface CalendarMonth {
  year: number;
  /** 1〜12。 */
  month: number;
  /** 「2026年9月」 */
  label: string;
  /** 月曜始まりの週の並び。常に7日ぶんそろっている。 */
  weeks: CalendarDay[][];
  /** その月に動いた日数。 */
  activeDays: number;
  km: number;
  minutes: number;
  kcal: number | null;
  /** いちばん長く走った日の距離。枡の濃さを決める基準。 */
  longestKm: number;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function dateKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** その日が属する週の月曜（0=月 … 6=日）。 */
function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/**
 * 痛みを抱えていた日。
 *
 * **走れなかった日の理由が見えることが大事。** 空白だけが並んでいると
 * 「サボった」に見えるが、痛くて止めた日は、止めたほうが正しかった日。
 */
function painDays(profile: RunnerProfile, now: Date): Set<string> {
  const days = new Set<string>();
  const todayKey = dateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());

  for (const pain of profile.pains ?? []) {
    const from = (pain.since ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) continue;
    // 治っていなければ、今日まで続いている。
    const to = pain.status === 'resolved' ? pain.updatedAt.slice(0, 10) : todayKey;
    if (to < from) continue;

    /*
      **日付の文字列のまま数える。** 時刻を持つ値で比べると、
      端末の時間帯や夏時間で1日ずれる。ずれた1日は、痛かった日が
      痛くなかったことになる、いちばん気づきにくい間違い方をする。
    */
    const cursor = new Date(`${from}T00:00:00Z`);
    if (Number.isNaN(cursor.getTime())) continue;
    // 長すぎる範囲は、記録の取り違えとして打ち切る（1年）。
    for (let guard = 0; guard < 366; guard += 1) {
      const key = cursor.toISOString().slice(0, 10);
      if (key > to) break;
      days.add(key);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  return days;
}

/**
 * ひと月ぶんを組み立てる。
 *
 * @param month 1〜12。
 */
export function buildMonth(
  profile: RunnerProfile | null | undefined,
  year: number,
  month: number,
  now: Date = new Date(),
): CalendarMonth {
  const activities = profile?.activities ?? [];
  const weightKg = profile?.bodyWeightKg;

  const byDate = new Map<string, ActivityLog[]>();
  for (const activity of activities) {
    const key = (activity.date ?? '').slice(0, 10);
    if (!key) continue;
    const list = byDate.get(key);
    if (list) list.push(activity);
    else byDate.set(key, [activity]);
  }

  const weights = new Map<string, number>();
  for (const record of profile?.dailyLog ?? []) {
    if (record.weightKg !== undefined) weights.set(record.date, record.weightKg);
  }

  const hurt = profile ? painDays(profile, now) : new Set<string>();
  const todayKey = dateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());

  // 1日が属する週の月曜から描き始める。
  const first = new Date(year, month - 1, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - mondayIndex(first));

  const weeks: CalendarDay[][] = [];
  let activeDays = 0;
  let km = 0;
  let minutes = 0;
  let kcal = 0;
  let countedKcal = false;
  let longestKm = 0;

  const cursor = new Date(start);
  for (let week = 0; week < 6; week += 1) {
    const row: CalendarDay[] = [];
    for (let index = 0; index < 7; index += 1) {
      const key = dateKey(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate());
      const inMonth = cursor.getMonth() + 1 === month && cursor.getFullYear() === year;
      const logs = byDate.get(key) ?? [];
      const dayKm = logs.reduce((sum, log) => sum + (log.distanceKm ?? 0), 0);
      const dayMin = logs.reduce((sum, log) => sum + (log.durationMin ?? 0), 0);
      const each = logs
        .map((log) => estimateCalories(log, weightKg))
        .filter((value): value is number => value !== null);
      const dayKcal = each.length > 0 ? each.reduce((sum, value) => sum + value, 0) : null;

      row.push({
        date: key,
        day: cursor.getDate(),
        inMonth,
        km: dayKm,
        minutes: dayMin,
        kcal: dayKcal,
        types: logs.map((log) => log.type),
        weightKg: weights.get(key),
        pain: hurt.has(key),
        isToday: key === todayKey,
        isFuture: key > todayKey,
      });

      if (inMonth) {
        if (logs.length > 0) activeDays += 1;
        km += dayKm;
        minutes += dayMin;
        if (dayKcal !== null) {
          kcal += dayKcal;
          countedKcal = true;
        }
        longestKm = Math.max(longestKm, dayKm);
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(row);
  }

  return {
    year,
    month,
    label: `${year}年${month}月`,
    weeks,
    activeDays,
    km: Math.round(km * 10) / 10,
    minutes: Math.round(minutes),
    kcal: countedKcal ? kcal : null,
    longestKm,
  };
}

/**
 * 記録のある月の範囲。
 *
 * **記録より前の月へは戻れないようにする。** いくらでも遡れると、
 * 空っぽの月を延々めくることになり、そこで終わる。
 */
export function monthRange(
  profile: RunnerProfile | null | undefined,
  now: Date = new Date(),
): { first: { year: number; month: number }; last: { year: number; month: number } } {
  const last = { year: now.getFullYear(), month: now.getMonth() + 1 };
  const dates = (profile?.activities ?? [])
    .map((activity) => (activity.date ?? '').slice(0, 10))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  const earliest = dates[0];
  if (!earliest) return { first: last, last };
  const year = Number(earliest.slice(0, 4));
  const month = Number(earliest.slice(5, 7));
  // 今月より先には行かない。
  if (year > last.year || (year === last.year && month > last.month)) return { first: last, last };
  return { first: { year, month }, last };
}

/** ひと月ぶん動かす。 */
export function shiftMonth(
  year: number,
  month: number,
  by: number,
): { year: number; month: number } {
  const index = year * 12 + (month - 1) + by;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** 枡の濃さ（0〜1）。**その月のいちばん長い日を 1 にする。** */
export function intensityOf(day: CalendarDay, longestKm: number): number {
  if (day.km <= 0) return 0;
  if (longestKm <= 0) return 1;
  // 短い日も見えるように、下限を置く。
  return Math.max(0.25, Math.min(1, day.km / longestKm));
}
