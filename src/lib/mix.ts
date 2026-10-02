/**
 * 練習の強弱が、偏っていないか。
 *
 * **市民ランナーのいちばん多い間違いが、ここにある。**
 * 速くもなく遅くもない、中途半端な速さで全部を走ってしまう。
 *
 *     イージーには速すぎて、疲れが抜けない。
 *     ポイントには遅すぎて、強くはならない。
 *
 * 毎日まじめに走っているのに記録が伸びない人は、たいていこれ。
 * 本人には**気づきようがない。** 1本ずつ見れば、どの練習も悪くないので。
 *
 * ## なぜ、ほかのアプリが言わないのか
 *
 * 時計のアプリは1本ずつを採点する。Strava は人と比べる。
 * **「あなたの全部の練習を並べると、こういう形になっている」を言う相手がいない。**
 * これは全履歴を持っていて初めて言えることで、1本の記録を貼って相談しても
 * 絶対に出てこない。コーチが10秒で見抜くのに、道具が誰も言わない場所。
 *
 * ## やらないこと
 *
 * - **責めない。** 「junk miles」と呼ばない。本人はまじめに走っている。
 * - **言い切らない材料で言わない。** 本数が少ない時は黙る。
 * - **痛みがある人に、速く走れと言わない。** ここは例外なし。
 * - **目標ではなく、走れている力を基準にする。** 届いていない目標から帯を作ると、
 *   全部が「イージー」に見えてしまい、逆の助言になる。
 */

import type { ActivityLog, RunnerProfile } from './types';
import { PACE_RATIO, estimateVdot, formatPace } from './goals';
import { timeForVdot } from './fitness';
import { coachDate } from './day';
import { MARATHON_KM } from './goals';

/** さかのぼる日数。これより長いと、季節も体力も違う時期が混ざる。 */
export const WINDOW_DAYS = 90;
/** これだけ本数が無ければ、形を語らない。 */
export const MIN_RUNS = 12;
/** 力を測る材料にする、最短の距離。流しや帰り道は入れない。 */
const MIN_KM = 3;
/** ペースとして、あり得る幅（秒/km）。 */
const MIN_PACE_SEC = 150;
const MAX_PACE_SEC = 900;

const DAY_MS = 86_400_000;

export type Band = 'easy' | 'grey' | 'hard';

export interface MixBand {
  band: Band;
  label: string;
  runs: number;
  km: number;
  /** 距離に占める割合(%)。 */
  percent: number;
}

export type MixVerdict = 'no-easy' | 'grey' | 'flat' | 'balanced' | 'unknown';

export interface PaceMix {
  /** 基準にしたマラソン相当のペース（秒/km）。 */
  anchorPaceSec: number;
  /** その基準が、どこから来たか。 */
  anchorFrom: 'performance' | 'goal';
  /** 基準にした記録。 */
  anchorRun?: { date: string; km: number; pace: string };
  easyFromSec: number;
  thresholdSec: number;
  bands: MixBand[];
  runs: number;
  km: number;
  verdict: MixVerdict;
  headline: string;
  detail: string;
  /** 変えるなら、何をひとつ変えるか。 */
  next?: string;
}

const LABEL: Record<Band, string> = {
  easy: 'ゆっくり',
  grey: '中くらい',
  hard: '速い',
};

function dayIndex(date: string): number | undefined {
  const at = Date.parse(`${(date ?? '').slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(at) ? undefined : Math.round(at / DAY_MS);
}

function paceSecOf(activity: ActivityLog): number | undefined {
  const km = activity.distanceKm;
  const min = activity.durationMin;
  if (!km || !min || km <= 0 || min <= 0) return undefined;
  const pace = (min * 60) / km;
  return pace >= MIN_PACE_SEC && pace <= MAX_PACE_SEC ? pace : undefined;
}

function recentRuns(profile: RunnerProfile, now: Date): ActivityLog[] {
  const today = dayIndex(coachDate(now));
  if (today === undefined) return [];
  return (profile.activities ?? []).filter((activity) => {
    if (activity.type !== 'run') return false;
    if ((activity.distanceKm ?? 0) < MIN_KM) return false;
    if (paceSecOf(activity) === undefined) return false;
    const at = dayIndex(activity.date);
    if (at === undefined) return false;
    const ago = today - at;
    return ago >= 0 && ago <= WINDOW_DAYS;
  });
}

/**
 * 帯を作る基準。
 *
 * **走れている力から作る。目標からではない。**
 * 3時間半を目指しているが実際は4時間半の力、という人の帯を目標から作ると、
 * 本当はぜんぶ中途半端な速さなのに、画面には「全部イージー」と出てしまう。
 * 逆の助言になる。
 */
export interface FitnessAnchor {
  /** マラソン相当のペース（秒/km）。 */
  paceSec: number;
  from: PaceMix['anchorFrom'];
  run?: ActivityLog;
}

/**
 * この人にとっての「イージー」が何分何秒なのか、の土台。
 *
 * **アプリ全体で、ここ1か所から配る。**
 * 今日やることの帯が目標から、練習の強弱が走れている力から出していると、
 * 同じ画面に「イージー 6:13」と「6:44より遅ければゆっくり」が並ぶ。
 * どちらが本当なのか分からない画面は、それだけで信用されない。
 */
export function fitnessAnchor(
  profile: RunnerProfile | null | undefined,
  now: Date = new Date(),
): FitnessAnchor | null {
  if (!profile) return null;
  return anchorOf(recentRuns(profile, now), profile);
}

function anchorOf(
  runs: ActivityLog[],
  profile: RunnerProfile,
): { paceSec: number; from: PaceMix['anchorFrom']; run?: ActivityLog } | null {
  let best: { vdot: number; run: ActivityLog } | null = null;

  for (const activity of runs) {
    const km = activity.distanceKm!;
    const pace = paceSecOf(activity)!;
    const vdot = estimateVdot(km * 1000, pace * km);
    if (vdot === undefined) continue;
    if (!best || vdot > best.vdot) best = { vdot, run: activity };
  }

  if (best) {
    const marathonSec = timeForVdot(MARATHON_KM, best.vdot);
    if (marathonSec !== undefined && marathonSec > 0) {
      return { paceSec: marathonSec / MARATHON_KM, from: 'performance', run: best.run };
    }
  }

  // 走れている力が出せない時だけ、目標から。
  const goalPace = profile.goal?.targetTime
    ? (() => {
        const parts = profile.goal!.targetTime!.split(':').map(Number);
        if (parts.some((n) => !Number.isFinite(n))) return undefined;
        const seconds =
          parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
        return seconds > 0 ? seconds / MARATHON_KM : undefined;
      })()
    : undefined;

  return goalPace ? { paceSec: goalPace, from: 'goal' } : null;
}

/**
 * 直近の練習を、強弱の帯で数える。
 *
 * **本数ではなく距離で数える。** 30kmのロング1本と5kmのジョグ1本を
 * 同じ1票にすると、形が実態とずれる。
 */
export function paceMix(profile: RunnerProfile | null | undefined, now: Date = new Date()): PaceMix | null {
  if (!profile) return null;
  const runs = recentRuns(profile, now);
  if (runs.length < MIN_RUNS) return null;

  const anchor = anchorOf(runs, profile);
  if (!anchor) return null;

  const easyFromSec = anchor.paceSec * PACE_RATIO.easyFrom;
  const thresholdSec = anchor.paceSec * PACE_RATIO.threshold;

  const totals: Record<Band, { runs: number; km: number }> = {
    easy: { runs: 0, km: 0 },
    grey: { runs: 0, km: 0 },
    hard: { runs: 0, km: 0 },
  };

  for (const activity of runs) {
    const pace = paceSecOf(activity)!;
    // 遅い＝数字が大きい。
    const band: Band = pace >= easyFromSec ? 'easy' : pace <= thresholdSec ? 'hard' : 'grey';
    totals[band].runs += 1;
    totals[band].km += activity.distanceKm ?? 0;
  }

  const km = Object.values(totals).reduce((sum, item) => sum + item.km, 0);
  if (km <= 0) return null;

  const bands: MixBand[] = (['easy', 'grey', 'hard'] as const).map((band) => ({
    band,
    label: LABEL[band],
    runs: totals[band].runs,
    km: Math.round(totals[band].km * 10) / 10,
    percent: Math.round((totals[band].km / km) * 100),
  }));

  const share = (band: Band) => bands.find((item) => item.band === band)!.percent;
  const { verdict, headline, detail, next } = judge(share('easy'), share('grey'), share('hard'), anchor);

  return {
    anchorPaceSec: Math.round(anchor.paceSec),
    anchorFrom: anchor.from,
    anchorRun: anchor.run
      ? {
          date: anchor.run.date,
          km: Math.round((anchor.run.distanceKm ?? 0) * 10) / 10,
          pace: formatPace(paceSecOf(anchor.run)!),
        }
      : undefined,
    easyFromSec: Math.round(easyFromSec),
    thresholdSec: Math.round(thresholdSec),
    bands,
    runs: runs.length,
    km: Math.round(km),
    verdict,
    headline,
    detail,
    next,
  };
}

/**
 * 形を読む。
 *
 * **責めない。** 「無駄な距離」とは呼ばない。本人はまじめに走っている。
 *
 * ## 短く書く
 *
 * ここの文章は、以前は1枚で300字を超えていた。
 * 「なぜそれが問題なのか」を画面で説明していたためで、
 * **それはこのコメントの仕事**だった。読む人に要るのは結論と、次の一手だけ。
 *
 *  - detail は**1行**。なぜ、を30字以内で
 *  - next は**動詞ひとつ**。「〜しましょう」の説明文にしない
 */
function judge(
  easy: number,
  grey: number,
  hard: number,
  anchor: { paceSec: number; from: PaceMix['anchorFrom'] },
): { verdict: MixVerdict; headline: string; detail: string; next?: string } {
  const easyPace = formatPace(anchor.paceSec * PACE_RATIO.easyFrom);
  const hardPace = formatPace(anchor.paceSec * PACE_RATIO.threshold);

  /*
    速い日はあるのに、ゆっくりの日が無い。

    **「刺激が足りない」とは別の話で、助言も逆になる。**
    こちらに足りないのは強度ではなく、抜く日。
    全部の練習に負荷がかかっていて、回復する日がどこにも無い状態。
  */
  if (easy <= 15 && hard >= 10) {
    return {
      verdict: 'no-easy',
      headline: 'ゆっくり走る日が、ありません',
      detail: 'どの練習にも負荷がかかっていて、抜く日がありません。',
      next: `つなぎの日を ${easyPace} より遅く`,
    };
  }

  // 中途半端な速さに寄っている。いちばん多い形。
  if (grey >= 60 && easy <= 25) {
    return {
      verdict: 'grey',
      headline: '中くらいの速さに、かたよっています',
      detail: 'イージーには速すぎ、ポイントには遅すぎる幅です。',
      next: `ゆっくりは ${easyPace} より遅く、速い日は ${hardPace} より速く`,
    };
  }

  /*
    ゆっくりばかりで、刺激がない。

    境目を 8% に置いてある。0%にできないのは、**基準にしているのが
    その期間でいちばん速かった1本**だからで、その1本は必ず「速い」側に入る。
    だから「速い日がゼロ」という形は、作りのうえで存在しない。

    ここで見たいのは「2週間に1本も無い」くらいの薄さなので、距離の8%を境にする。

    なお、レースも計測も無い人について
    **「ゆっくり6:00」と「全力で6:00」は、記録からは区別できない。**
    そこは正直に、断定しない書き方にしてある。
  */
  if (hard <= 8 && easy >= 70) {
    return {
      verdict: 'flat',
      headline: '速い日が、ほとんどありません',
      detail: '土台は良い形ですが、速くなる刺激が入っていません。',
      next: `週に1本、${hardPace} より速い日を`,
    };
  }

  return {
    verdict: 'balanced',
    headline: 'ゆっくりと速いが、分かれています',
    detail: '日ごとの強弱が分かれています。この並びは続ける価値があります。',
  };
}

/**
 * プロンプトに差し込む、練習の形。
 * **画面に出ているものと、コーチの言うことを食い違わせない。**
 */
export function mixDoctrine(
  profile: RunnerProfile | null | undefined,
  now: Date = new Date(),
): string | null {
  const mix = paceMix(profile, now);
  if (!mix) return null;

  const lines = [
    '# 画面に出ている「練習の強弱」（**この集計は計算済み。自分で数え直さないこと**）',
    `- 直近${WINDOW_DAYS}日 ${mix.runs}本 / ${mix.km}km`,
    `- ${mix.bands.map((band) => `${band.label} ${band.percent}%`).join(' / ')}`,
    `- 帯の境目: ${formatPace(mix.easyFromSec)} より遅ければ「ゆっくり」、${formatPace(mix.thresholdSec)} より速ければ「速い」`,
    mix.anchorFrom === 'performance'
      ? `- 基準は**走れている力**から出している（目標からではない）`
      : `- まだ力を測れる記録が無いので、目標から帯を作っている。**断定を弱めること。**`,
    `- 画面の見出し: ${mix.headline}`,
  ];
  if (mix.next) lines.push(`- 画面に出している次の一手: ${mix.next}`);

  lines.push(
    '- **「無駄な距離」「junk miles」と呼ばないこと。** 本人はまじめに走っている。',
    '- **痛みがある時は、速い日を勧めないこと。** ここは例外なし。',
    '- 変えるよう勧めるのは**ひとつだけ**。全部変えさせると、どれも続かない。',
  );
  return lines.join('\n');
}
