/**
 * 積み方が急すぎないかを見る層。
 *
 * **走る人が壊れるのは、走りすぎた時ではなく「急に増やした時」。**
 * 週40kmを1年続けている人は壊れにくく、週20kmから急に40kmにした人が壊れる。
 * 同じ40kmでも、体にとっては別物になる。
 *
 * 見るのは2つの比。
 *
 *   直近7日の距離 ÷ 直前4週の1週あたりの平均
 *
 * 1.3を超えたあたりから故障が増え、1.5を超えると目に見えて増える、というのが
 * スポーツ医学でよく使われる目安（急性:慢性の比）。
 *
 * **これは本人には絶対に見えない。** 毎週の距離を数えて、4週平均と割り算して、
 * 初めて出る数字で、走っている最中にはどこにも表示されない。
 * そして気づくのは、たいてい痛くなってから。
 *
 * ## やらないこと
 *
 * - **責めない。** 増やしたこと自体は悪くない。増やし方の速さだけを言う。
 * - **走るなと言わない。** それは痛みがある時だけの言葉で、ここで使うと効き目が薄れる。
 * - **数字が足りない時は黙る。** 4週ぶんの土台が無ければ、比は意味を持たない。
 */

import type { ActivityLog, RunnerProfile } from './types';
import { coachDate } from './day';

/** 直近の負荷を見る日数。 */
export const ACUTE_DAYS = 7;
/** 土台を見る週数。これより短いと、1週の上下に振り回される。 */
export const CHRONIC_WEEKS = 4;
const CHRONIC_DAYS = ACUTE_DAYS * (CHRONIC_WEEKS + 1);

/** ここから「少し急ぎ気味」。 */
export const WATCH_RATIO = 1.3;
/** ここから「急」。故障が目に見えて増える。 */
export const HIGH_RATIO = 1.5;

/** 土台がこれ未満なら、比ではなく「戻り始め」として見る。 */
const MIN_CHRONIC_KM = 5;
/** 戻り始めとして言うだけの距離。これ未満なら何も言わない。 */
const MIN_RETURN_KM = 10;
/** 比を出すのに要る、記録の古さ（日）。 */
const MIN_HISTORY_DAYS = 21;

const DAY_MS = 86_400_000;

/** その日を、1970年からの通算日数にする。 */
function dayIndex(date: string): number | undefined {
  const at = Date.parse(`${(date ?? '').slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(at) ? undefined : Math.round(at / DAY_MS);
}

/**
 * 何日前か。今日なら 0。
 *
 * **時刻で引き算しない。** サーバーの時計は UTC なので、
 * 日本の朝に「今日の練習」を引くと負の数になり、直近7日から外れてしまう。
 * 走る人の地域での「何日の練習か」だけで数える。
 */
function daysAgo(date: string, now: Date): number | undefined {
  const at = dayIndex(date);
  const today = dayIndex(coachDate(now));
  if (at === undefined || today === undefined) return undefined;
  return today - at;
}

/**
 * 距離を積む対象。
 * **走った分だけを数える。** 歩きや自転車は、脚への当たり方が違う。
 */
function runKm(activity: ActivityLog): number {
  if (activity.type !== 'run') return 0;
  return activity.distanceKm ?? 0;
}

export type WorkloadLevel =
  /** 無理のない積み方。 */
  | 'ok'
  /** 少し急ぎ気味。 */
  | 'watch'
  /** 急。ここが、故障が増える所。 */
  | 'high'
  /** 戻り始め。比ではなく、戻し方の話をする。 */
  | 'returning';

export interface Workload {
  /** 直近7日の走行距離。 */
  acuteKm: number;
  /** 直前4週の、1週あたりの平均。 */
  chronicKm: number;
  /** acute ÷ chronic。土台が足りない時は undefined。 */
  ratio?: number;
  level: WorkloadLevel;
  /** 今週、ここまでなら急にならない距離。 */
  safeKm: number;
}

/**
 * いまの積み方。
 * **語れるだけの記録が無ければ null。** 足りない数字で断定しない。
 */
export function workloadOf(profile: RunnerProfile, now: Date = new Date()): Workload | null {
  const activities = profile.activities ?? [];
  if (activities.length === 0) return null;

  let acuteKm = 0;
  let chronicTotal = 0;
  let oldest = 0;

  for (const activity of activities) {
    const ago = daysAgo(activity.date, now);
    if (ago === undefined || ago < 0) continue;
    oldest = Math.max(oldest, ago);
    const km = runKm(activity);
    if (km <= 0) continue;
    if (ago < ACUTE_DAYS) acuteKm += km;
    else if (ago < CHRONIC_DAYS) chronicTotal += km;
  }

  // 走っていない週に、積み方の話をしない。
  if (acuteKm <= 0) return null;
  // 4週ぶんの土台が無い人に、比を出さない。**無いものを割らない。**
  if (oldest < MIN_HISTORY_DAYS) return null;

  const round = (value: number) => Math.round(value * 10) / 10;
  const chronicKm = round(chronicTotal / CHRONIC_WEEKS);

  if (chronicKm < MIN_CHRONIC_KM) {
    // 直前4週をほとんど走っていない。比を出すと桁外れの数字になるだけ。
    if (acuteKm < MIN_RETURN_KM) return null;
    return {
      acuteKm: round(acuteKm),
      chronicKm,
      level: 'returning',
      safeKm: round(Math.max(acuteKm, MIN_RETURN_KM)),
    };
  }

  const ratio = Math.round((acuteKm / chronicKm) * 100) / 100;
  const level: WorkloadLevel = ratio >= HIGH_RATIO ? 'high' : ratio >= WATCH_RATIO ? 'watch' : 'ok';

  return {
    acuteKm: round(acuteKm),
    chronicKm,
    ratio,
    level,
    safeKm: round(chronicKm * WATCH_RATIO),
  };
}

/**
 * 画面に出す言葉。
 *
 * **数字を見せてから、次の一手を出す。** 「増やしすぎです」だけでは、
 * どこまでなら良かったのかが分からず、ただ不安になって終わる。
 */
export function describeWorkload(workload: Workload): { title: string; detail: string } | null {
  const { acuteKm, chronicKm, ratio, safeKm } = workload;

  switch (workload.level) {
    case 'high':
      return {
        title: '今週は、積み方が急です',
        detail:
          `直近7日で${acuteKm}km。直前4週の平均は1週あたり${chronicKm}kmなので、${ratio}倍になっています。` +
          `故障が増えるのは、走った量そのものより「急に増えた時」です。` +
          `今週は${safeKm}kmあたりまでにしておくと、積み上げはそのまま続きます。`,
      };
    case 'watch':
      return {
        title: '少し急ぎ気味です',
        detail:
          `直近7日で${acuteKm}km。直前4週の平均（1週あたり${chronicKm}km）の${ratio}倍です。` +
          `まだ危ない数字ではありませんが、来週も同じ勢いで増やすと、そこが急になります。`,
      };
    case 'returning':
      return {
        title: '戻ってきたところです',
        detail:
          `直前4週はほとんど走っていないので、直近7日の${acuteKm}kmは、体にとっては新しい負荷です。` +
          `戻り始めは、同じ距離でも脚への当たり方が違います。2〜3週かけて戻すのが、いちばん速い戻り方です。`,
      };
    case 'ok':
      return null;
  }
}

/**
 * プロンプトに差し込む、積み方。
 *
 * **数値は計算済み。** モデルに距離を足し算させると、桁を間違えたまま断定する。
 */
export function workloadDoctrine(profile: RunnerProfile, now: Date = new Date()): string | null {
  const workload = workloadOf(profile, now);
  if (!workload) return null;

  const lines = [
    '# 練習量の積み方（**この数値は計算済み。自分で足し直さないこと**）',
    `- 直近7日: ${workload.acuteKm}km`,
    `- 直前4週の平均: 1週あたり ${workload.chronicKm}km`,
  ];
  if (workload.ratio !== undefined) {
    lines.push(
      `- 比: ${workload.ratio}倍（${WATCH_RATIO}倍から注意、${HIGH_RATIO}倍から故障が目に見えて増える）`,
    );
  }

  if (workload.level === 'high') {
    lines.push(
      `- **積み方が急。今週は ${workload.safeKm}km あたりまでに収める提案をすること。**`,
      '- **走るなとは言わない。** それは痛みがある時の言葉で、ここで使うと効き目が薄れる。',
      '  言うのは「増やす速さ」だけ。距離を減らすのではなく、増やすのを一度止める。',
      '- **増やしたこと自体を責めない。** 走れている時に増やしたくなるのは当たり前で、',
      '  それを止めるのではなく、来月も走れている形に均す話をする。',
    );
  } else if (workload.level === 'watch') {
    lines.push(
      '- 少し急ぎ気味。**まだ警告しない。** 来週も同じ勢いなら、その時に言う。',
      '  いま言うなら「来週は増やさずに同じくらいで」の一言まで。',
    );
  } else if (workload.level === 'returning') {
    lines.push(
      '- **戻り始め。** 直前4週をほとんど走っていないので、いまの距離は体にとって新しい負荷。',
      '  2〜3週かけて戻す前提で組むこと。前に走れていた距離を基準にしない。',
    );
  } else {
    lines.push('- 無理のない積み方。**わざわざ褒めない。** 聞かれた時に答えれば足りる。');
  }

  lines.push(
    '- この数字は、走っている最中にはどこにも出ない。**痛くなる前に言えるのが、ここの価値。**',
  );
  return lines.join('\n');
}
