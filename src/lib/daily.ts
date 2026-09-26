import type { DailyRecord, RunnerProfile } from './types';
import { today } from './profile';
import { shiftDay } from './day';

/**
 * 毎日の記録とスタンプ。
 *
 * 続ける人と続かない人を分けるのは、意志より「今日やった」という手応えの有無。
 * 走った日だけでなく、開いた日・体重をはかった日も等しくスタンプにする。
 * 走れなかった日を空白にすると、それ自体が責める仕組みになってしまう。
 */

export type StampId = 'opened' | 'weighed' | 'moved';

export interface Stamp {
  id: StampId;
  label: string;
  /**
   * 絵柄は StampIcon が持つ。ここには置かない。
   * **端末ごとに絵柄の変わる絵文字は、説明の道具にならない。**
   */
  done: boolean;
  hint: string;
}

export interface DailyStatus {
  date: string;
  stamps: Stamp[];
  /** 今日の達成数。 */
  earned: number;
  /** 連続で開いた日数。 */
  streakDays: number;
  /** 今日到達した節目（あれば）。 */
  milestone?: number;
  /** 直近の体重。 */
  latestWeightKg?: number;
}

/** 祝う節目。細かすぎても、遠すぎても効かない。 */
export const MILESTONES = [3, 7, 14, 30, 50, 100, 200, 365];

/**
 * 日付を1日ずらす。
 * **実時刻に戻して計算しない。** 地域や夏時間を通すと、そこで1日ずれる。
 */
function shiftDate(date: string, days: number): string {
  return shiftDay(date, days);
}

export function findRecord(profile: RunnerProfile, date: string): DailyRecord | undefined {
  return profile.dailyLog?.find((record) => record.date === date);
}

/** 今日このアプリを開いた、を記録する。同じ日に何度呼んでも増えない。 */
export function markOpened(profile: RunnerProfile, now: Date = new Date()): RunnerProfile {
  const date = today(now);
  const log = profile.dailyLog ?? [];
  const existing = log.find((record) => record.date === date);
  if (existing?.opened) return profile;

  const next = existing
    ? log.map((record) => (record.date === date ? { ...record, opened: true } : record))
    : [...log, { date, opened: true }];

  return { ...profile, dailyLog: trimLog(next), updatedAt: now.toISOString() };
}

/** 体重を記録する。習慣にしたいのは「はかること」なので、増減は評価しない。 */
export function logWeight(
  profile: RunnerProfile,
  weightKg: number,
  date: string = today(),
  now: Date = new Date(),
): RunnerProfile {
  const log = profile.dailyLog ?? [];
  const exists = log.some((record) => record.date === date);
  const next = exists
    ? log.map((record) => (record.date === date ? { ...record, weightKg } : record))
    : [...log, { date, opened: true, weightKg }];

  return {
    ...profile,
    dailyLog: trimLog(next),
    // 最新の体重はプロフィール側にも持たせ、コーチがすぐ参照できるようにする。
    bodyWeightKg: weightKg,
    updatedAt: now.toISOString(),
  };
}

/** 記録は増え続けるので、直近1年分だけ残す。 */
function trimLog(log: DailyRecord[]): DailyRecord[] {
  const sorted = [...log].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.length > 400 ? sorted.slice(sorted.length - 400) : sorted;
}

/** 連続で開いた日数。今日まだ開いていなければ、昨日までの連続を数える。 */
export function streakDays(profile: RunnerProfile, now: Date = new Date()): number {
  const opened = new Set((profile.dailyLog ?? []).filter((r) => r.opened).map((r) => r.date));
  if (opened.size === 0) return 0;

  const start = opened.has(today(now)) ? today(now) : shiftDate(today(now), -1);
  if (!opened.has(start)) return 0;

  let count = 0;
  let cursor = start;
  while (opened.has(cursor)) {
    count += 1;
    cursor = shiftDate(cursor, -1);
  }
  return count;
}

/** その日に走った・歩いた・補強したか。行動記録から導く。 */
function movedOn(profile: RunnerProfile, date: string): boolean {
  return profile.activities.some((activity) => activity.date === date && activity.type !== 'rest');
}

export function dailyStatus(profile: RunnerProfile, now: Date = new Date()): DailyStatus {
  const date = today(now);
  const record = findRecord(profile, date);
  const streak = streakDays(profile, now);

  const stamps: Stamp[] = [
    {
      id: 'opened',
      label: 'コーチに会う',
      done: Boolean(record?.opened),
      hint: 'アプリを開くだけで押されます',
    },
    {
      id: 'weighed',
      label: '体重をはかる',
      done: record?.weightKg !== undefined,
      hint: '増えた減ったは気にしない。乗ることが習慣です',
    },
    {
      id: 'moved',
      label: '体を動かす',
      done: movedOn(profile, date),
      hint: '走る・歩く・補強、どれでも構いません',
    },
  ];

  const latest = [...(profile.dailyLog ?? [])]
    .filter((r) => r.weightKg !== undefined)
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);

  return {
    date,
    stamps,
    earned: stamps.filter((stamp) => stamp.done).length,
    streakDays: streak,
    milestone: MILESTONES.includes(streak) ? streak : undefined,
    latestWeightKg: latest?.weightKg,
  };
}

/** プロンプトに差し込む、今日の状態。 */
export function dailyDoctrine(profile: RunnerProfile, now: Date = new Date()): string {
  const status = dailyStatus(profile, now);
  const lines = ['# 今日のスタンプ', `- 連続で開いた日数: ${status.streakDays}日`];

  for (const stamp of status.stamps) {
    lines.push(`- ${stamp.label}: ${stamp.done ? '達成' : 'まだ'}`);
  }
  if (status.latestWeightKg !== undefined) {
    lines.push(`- 直近の体重: ${status.latestWeightKg}kg`);
  }
  if (status.milestone) {
    lines.push(
      `- **今日で${status.milestone}日連続。** これは本人にとって大きな節目。返答のどこかで必ず触れ、心から祝うこと。`,
    );
  }
  lines.push(
    '- 体重は「はかったこと」を評価する。増減そのものを責めない。日々の変動は水分で1〜2kg動く。',
    '- 体重が未記録なら、会話の流れで一度だけ、圧をかけずに促してよい。毎回は言わない。',
  );
  return lines.join('\n');
}
