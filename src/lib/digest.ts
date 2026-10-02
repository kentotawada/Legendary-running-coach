/**
 * この7日の、ふりかえり。
 *
 * **走った記録は貯まっていくのに、「で、今週はどうだったのか」を誰も言わない。**
 * 月ごとの棒グラフは積み上げを見せるが、今週の自分には答えていない。
 *
 * ここで出すのは、**その週だけを見て分かること**。
 * 距離・本数・前の7日との差・いちばん長かった1本・体に出たこと。
 *
 * ## やらないこと
 *
 * - **「よく頑張りました」を言わない。** 数字を見せれば、本人が判断できる。
 *   頑張りの評価を外から渡すと、少ない週に開けなくなる。
 * - **減った週を責めない。** 走れない週には理由があるし、減らすのが正しい週もある。
 * - **足りない記録で語らない。** 1本も走っていない週は、数字の話をしない。
 */

import type { ActivityLog, RunnerProfile } from './types';
import { coachDate } from './day';
import { formatPace } from './goals';

const DAY_MS = 86_400_000;
const WINDOW = 7;

export interface DigestRun {
  date: string;
  km: number;
  pace?: string;
  label?: string;
}

export interface WeeklyDigest {
  /** 直近7日。 */
  km: number;
  runs: number;
  minutes: number;
  /** その前の7日。 */
  prevKm: number;
  /** 差（km）。プラスなら増えた。 */
  deltaKm: number;
  /** いちばん長かった1本。 */
  longest?: DigestRun;
  /** 走った日数。 */
  days: number;
  /** 手応えを押した日数。 */
  rated: number;
  /** その週に記録された痛み。 */
  pains: string[];
  headline: string;
  detail: string;
}

function dayIndex(date: string): number | undefined {
  const at = Date.parse(`${(date ?? '').slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(at) ? undefined : Math.round(at / DAY_MS);
}

function daysAgo(date: string, now: Date): number | undefined {
  const at = dayIndex(date);
  const today = dayIndex(coachDate(now));
  if (at === undefined || today === undefined) return undefined;
  return today - at;
}

function paceOf(activity: ActivityLog): string | undefined {
  if (activity.metrics?.avgPace) return activity.metrics.avgPace;
  const km = activity.distanceKm;
  const min = activity.durationMin;
  if (!km || !min || km <= 0 || min <= 0) return undefined;
  return formatPace((min * 60) / km);
}

/**
 * 直近7日のふりかえり。
 *
 * **1本も走っていない週には、数字の話をしない。**
 * 0kmと書かれた画面を見せても、走れなかった理由は変わらない。
 */
export function weeklyDigest(profile: RunnerProfile, now: Date = new Date()): WeeklyDigest | null {
  const runs: ActivityLog[] = [];
  const prev: ActivityLog[] = [];

  for (const activity of profile.activities ?? []) {
    if (activity.type !== 'run') continue;
    const ago = daysAgo(activity.date, now);
    if (ago === undefined || ago < 0) continue;
    if (ago < WINDOW) runs.push(activity);
    else if (ago < WINDOW * 2) prev.push(activity);
  }

  if (runs.length === 0) return null;

  const sum = (list: ActivityLog[]) =>
    Math.round(list.reduce((total, item) => total + (item.distanceKm ?? 0), 0) * 10) / 10;

  const km = sum(runs);
  const prevKm = sum(prev);
  const minutes = Math.round(runs.reduce((total, item) => total + (item.durationMin ?? 0), 0));
  const days = new Set(runs.map((item) => item.date.slice(0, 10))).size;
  const rated = runs.filter((item) => item.effort !== undefined).length;

  const longestRun = runs
    .slice()
    .sort((a, b) => (b.distanceKm ?? 0) - (a.distanceKm ?? 0))[0];
  const longest: DigestRun | undefined = longestRun?.distanceKm
    ? {
        date: longestRun.date,
        km: Math.round(longestRun.distanceKm * 10) / 10,
        pace: paceOf(longestRun),
        label: longestRun.session,
      }
    : undefined;

  const pains = (profile.pains ?? [])
    .filter((pain) => {
      const ago = daysAgo(pain.since ?? pain.updatedAt.slice(0, 10), now);
      return pain.status !== 'resolved' && ago !== undefined && ago >= 0 && ago < WINDOW;
    })
    .map((pain) => pain.site);

  const deltaKm = Math.round((km - prevKm) * 10) / 10;

  /*
    **「よく頑張りました」を言わない。** 数字を見せれば、本人が判断できる。
    頑張りの評価を外から渡すと、少ない週にこの画面を開けなくなる。
  */
  const headline = `この7日で ${km}km / ${days}日`;
  const detail =
    prev.length === 0
      ? `${runs.length}本、合わせて${minutes}分。前の7日は記録がないので、比べるのは次からです。`
      : deltaKm === 0
        ? `${runs.length}本、合わせて${minutes}分。前の7日と同じ量です。`
        : deltaKm > 0
          ? `${runs.length}本、合わせて${minutes}分。前の7日（${prevKm}km）より ${deltaKm}km 多い。`
          : `${runs.length}本、合わせて${minutes}分。前の7日（${prevKm}km）より ${-deltaKm}km 少ない。減らすのが正しい週もあります。`;

  return { km, runs: runs.length, minutes, prevKm, deltaKm, longest, days, rated, pains, headline, detail };
}

/**
 * 通知に出す短い一言。
 * **帯に収まる長さで。** 長い通知は、開かれる前に閉じられる。
 */
export function digestLine(digest: WeeklyDigest): string {
  const parts = [`${digest.km}km / ${digest.days}日`];
  if (digest.longest) parts.push(`いちばん長いのは${digest.longest.km}km`);
  return parts.join('。');
}

/**
 * プロンプトに差し込む、この7日。
 * **コーチが「今週どうでしたか」と聞かないために。** もう画面に出ている。
 */
export function digestDoctrine(profile: RunnerProfile, now: Date = new Date()): string | null {
  const digest = weeklyDigest(profile, now);
  if (!digest) return null;

  const lines = [
    '# 画面に出ている「この7日」（**この数値は計算済み。自分で足し直さないこと**）',
    `- ${digest.headline}（${digest.runs}本 / ${digest.minutes}分）`,
    `- 前の7日: ${digest.prevKm}km（差 ${digest.deltaKm >= 0 ? '+' : ''}${digest.deltaKm}km）`,
  ];
  if (digest.longest) {
    lines.push(
      `- いちばん長い1本: ${digest.longest.date} ${digest.longest.km}km` +
        `${digest.longest.pace ? ` ${digest.longest.pace}` : ''}`,
    );
  }
  if (digest.pains.length > 0) lines.push(`- この7日に出た痛み: ${digest.pains.join('・')}`);
  if (digest.rated > 0) lines.push(`- 手応えを押した練習: ${digest.rated}本`);

  lines.push(
    '- **「今週は何km走りましたか」と聞かないこと。** もう画面に出ているし、本人も見ている。',
    '- **減った週を責めないこと。** 走れない週には理由があるし、減らすのが正しい週もある。',
    '- 褒めるなら、量ではなく**中身**を褒める。量を褒めると、翌週に無理をする。',
  );
  return lines.join('\n');
}
