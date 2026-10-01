/**
 * このまま続けたら、3か月後はどうなるか。
 *
 * **積み上げを見せるだけでは、足りない。** 過去のグラフは「やってきたこと」を
 * 見せるが、続ける理由にはなりにくい。「この調子なら、3月の大会で目標に届く」
 * が見えた時に、人は明日も走る。
 *
 * ただし、ここは**いちばん嘘をつきやすい場所**でもある。線を引いて伸ばすだけなら
 * 誰でもできるが、その線は現実には続かない。守っていること:
 *
 * 1. **必ず幅で出す。** 1つの数字は、それ自体が嘘になる。
 * 2. **伸びは鈍る。** 練習の効果は、同じ割合で永久には続かない。減衰を入れる。
 * 3. **体重には下限を置く。** 落ちる傾きをそのまま伸ばすと、3か月で危険な値になる。
 *    速すぎる減り方は「速すぎる」と言い、見込みとしては安全な速さに丸める。
 * 4. **足りないデータでは出さない。** 2回の記録に線を引いても、それは占い。
 * 5. **条件を必ず書く。**「このまま続けたら」であって、約束ではない。
 */

import { paceTrend, weightTrend } from './review';
import type { RunnerProfile } from './types';

/** 3か月。 */
export const HORIZON_WEEKS = 13;

/** これだけ無いと、線を引いても意味が無い。 */
const MIN_POINTS = 6;
const MIN_SPAN_DAYS = 21;

/**
 * 体重が減る速さの上限（1週あたり、いまの体重に対する割合）。
 *
 * 1%/週を超える減り方は、走る人にとっては**速すぎる**。
 * 筋肉も一緒に落ちるし、故障と貧血の入口でもある。
 * 実際にそう減っていても、**見込みとしてはここまでに丸める。**
 */
const MAX_WEEKLY_LOSS_RATIO = 0.01;

/**
 * 3か月で見込む下限（いまの体重に対する割合）。
 *
 * **身長を預かっていないので、BMI では止められない。**
 * そのかわり、いまの体重からの減り幅で止める。
 * 10%以上痩せる見込みは、たとえ数字がそう出ても画面には出さない。
 */
const MIN_TOTAL_RATIO = 0.9;

/**
 * 伸びが鈍る速さ（週）。
 *
 * 直線で伸ばすと、半年で世界記録に届いてしまう。
 * 累積の伸び = 傾き × τ × (1 − e^(−週/τ)) の形で頭打ちにする。
 * τ=8週 なら、13週ぶんの伸びは直線の約半分になる。
 */
const DECAY_WEEKS = 8;

interface Fit {
  /** 1週あたりの変化。 */
  perWeek: number;
  /** 使った点の数。 */
  points: number;
  /** 最初から最後までの日数。 */
  spanDays: number;
  /** ばらつき（残差の標準偏差）。幅を決めるのに使う。 */
  scatter: number;
}

/** 最小二乗で直線を当てる。x は日、y は値。 */
function fitLine(points: { x: number; y: number }[]): Fit | null {
  if (points.length < MIN_POINTS) return null;
  const spanDays = points[points.length - 1]!.x - points[0]!.x;
  if (spanDays < MIN_SPAN_DAYS) return null;

  const n = points.length;
  const meanX = points.reduce((sum, p) => sum + p.x, 0) / n;
  const meanY = points.reduce((sum, p) => sum + p.y, 0) / n;
  const varX = points.reduce((sum, p) => sum + (p.x - meanX) ** 2, 0);
  if (varX <= 0) return null;
  const cov = points.reduce((sum, p) => sum + (p.x - meanX) * (p.y - meanY), 0);
  const slope = cov / varX;
  const intercept = meanY - slope * meanX;

  const residuals = points.map((p) => p.y - (slope * p.x + intercept));
  const scatter = Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / Math.max(1, n - 2));

  return { perWeek: slope * 7, points: n, spanDays, scatter };
}

/** 頭打ちを入れた、週数ぶんの累積の変化。 */
function damped(perWeek: number, weeks: number): number {
  return perWeek * DECAY_WEEKS * (1 - Math.exp(-weeks / DECAY_WEEKS));
}

/** データが足りない時に、何が足りないかを言う。 */
export interface NotYet {
  ready: false;
  reason: string;
}

export interface WeightOutlook {
  ready: true;
  now: number;
  /** 3か月後の見込み（低い側・高い側）。 */
  low: number;
  high: number;
  /** 見込みに使った、1週あたりの変化（丸めたあと）。 */
  perWeek: number;
  /** 記録から読み取った、丸める前の1週あたりの変化。 */
  rawPerWeek: number;
  /** 減り方が速すぎたので丸めたか。**画面でそう言う。** */
  tooFast: boolean;
  /** 下限に当たったか。 */
  floored: boolean;
  direction: 'down' | 'up' | 'flat';
  points: number;
}

/**
 * 3か月後の体重。
 *
 * **落ちる線をそのまま伸ばさない。** 2週間で2kg落ちた人の線を13週伸ばすと
 * 13kg になる。そんな減り方は続かないし、続いたら体を壊す。
 */
export function weightOutlook(
  profile: RunnerProfile | null | undefined,
  now: Date = new Date(),
): WeightOutlook | NotYet {
  if (!profile) return { ready: false, reason: '体重の記録がありません' };
  const trend = weightTrend(profile, 120, now);
  if (trend.length < MIN_POINTS) {
    return {
      ready: false,
      reason: `体重をあと${MIN_POINTS - trend.length}回はかると、3か月後の見込みを出せます`,
    };
  }

  const base = Date.parse(`${trend[0]!.date}T12:00:00`);
  const fit = fitLine(
    trend.map((point) => ({
      x: (Date.parse(`${point.date}T12:00:00`) - base) / 86_400_000,
      y: point.kg,
    })),
  );
  if (!fit) return { ready: false, reason: 'もう少し期間が空いた記録がそろうと、見込みを出せます' };

  const current = trend[trend.length - 1]!.kg;
  const rawPerWeek = fit.perWeek;

  // 速すぎる減り方は、見込みとしては安全な速さに丸める。
  const limit = current * MAX_WEEKLY_LOSS_RATIO;
  const tooFast = rawPerWeek < -limit;
  const perWeek = tooFast ? -limit : rawPerWeek;

  /*
    **体重には減衰を入れない。** 練習の伸びは鈍るが、体重は
    「食べる量と動く量の差」で決まるので、同じ生活が続けば同じ速さで動く。
    ここで頭打ちを入れると、見込みが甘く出て、速すぎる減り方を見逃す。
    そのかわり、上の丸めと下限で止める。
  */
  const change = perWeek * HORIZON_WEEKS;
  let center = current + change;

  const floor = current * MIN_TOTAL_RATIO;
  const floored = center < floor;
  if (floored) center = floor;

  // 幅は、記録のばらつきと、見込みの大きさの両方から。
  const margin = Math.max(0.4, fit.scatter, Math.abs(change) * 0.35);

  const direction = Math.abs(change) < 0.3 ? 'flat' : change < 0 ? 'down' : 'up';

  return {
    ready: true,
    now: round1(current),
    low: round1(Math.max(floor, center - margin)),
    high: round1(center + margin),
    perWeek: round2(perWeek),
    rawPerWeek: round2(rawPerWeek),
    tooFast,
    floored,
    direction,
    points: fit.points,
  };
}


export interface PaceOutlook {
  ready: true;
  /** いまの練習ペース（秒/km）。 */
  now: number;
  /** 3か月後の見込み（速い側・遅い側、秒/km）。 */
  fast: number;
  slow: number;
  /** 1週あたりの変化（秒/km）。負なら速くなっている。 */
  perWeek: number;
  direction: 'faster' | 'slower' | 'flat';
  points: number;
}

/**
 * 3か月後の練習ペース。
 *
 * **直線で伸ばさない。** 練習の効果は最初が大きく、だんだん鈍る。
 * 直線のまま13週伸ばすと、ありえない数字になる。
 */
export function paceOutlook(
  profile: RunnerProfile | null | undefined,
  now: Date = new Date(),
): PaceOutlook | NotYet {
  if (!profile) return { ready: false, reason: '練習の記録がありません' };
  const trend = paceTrend(profile, { days: 120, minKm: 3, now });
  if (trend.length < MIN_POINTS) {
    return {
      ready: false,
      reason: `3km以上の練習をあと${MIN_POINTS - trend.length}回記録すると、3か月後の見込みを出せます`,
    };
  }

  const base = Date.parse(`${trend[0]!.date}T12:00:00`);
  const fit = fitLine(
    trend.map((point) => ({
      x: (Date.parse(`${point.date}T12:00:00`) - base) / 86_400_000,
      y: point.secondsPerKm,
    })),
  );
  if (!fit) return { ready: false, reason: 'もう少し期間が空いた記録がそろうと、見込みを出せます' };

  // いまの地点は、直近3本の平均。1本の調子で振れないように。
  const recent = trend.slice(-3);
  const current = recent.reduce((sum, p) => sum + p.secondsPerKm, 0) / recent.length;

  const change = damped(fit.perWeek, HORIZON_WEEKS);
  const center = Math.max(150, current + change);
  const margin = Math.max(4, fit.scatter * 0.6, Math.abs(change) * 0.4);

  const direction = Math.abs(change) < 2 ? 'flat' : change < 0 ? 'faster' : 'slower';

  return {
    ready: true,
    now: Math.round(current),
    fast: Math.round(Math.max(150, center - margin)),
    slow: Math.round(center + margin),
    perWeek: round1(fit.perWeek),
    direction,
    points: fit.points,
  };
}

export interface GoalOutlook {
  ready: true;
  /** 目標ペース（秒/km）。 */
  target: number;
  /** 3か月後の見込みで、目標にどれだけ足りないか（秒/km）。負なら届いている。 */
  gap: number;
  reaching: boolean;
  summary: string;
}

/**
 * 目標に届きそうか。
 *
 * **完走タイムを言い当てない。** 練習のペースと本番のペースは別物で、
 * 当日の気温・風・補給で何分も動く。言えるのは
 * 「いまの伸び方なら、目標のペースに届く位置にいる」までで、そこで止める。
 */
export function goalOutlook(
  profile: RunnerProfile | null | undefined,
  pace: PaceOutlook | NotYet,
  targetSecondsPerKm: number | undefined,
): GoalOutlook | null {
  if (!pace.ready || !targetSecondsPerKm || targetSecondsPerKm <= 0) return null;
  const gap = Math.round(pace.fast - targetSecondsPerKm);
  return {
    ready: true,
    target: Math.round(targetSecondsPerKm),
    gap,
    reaching: gap <= 0,
    /*
      **「届かない」と言い切らない。**
      ここで比べているのは**練習の平均ペース**と、目標のレースペース。
      ゆっくり走る日を含めた平均が目標ペースより遅いのは、
      むしろ正しい練習の形で、足りていないという意味ではない。
      数字は出すが、判断は押しつけない。
    */
    summary:
      gap <= 0
        ? '練習の平均が、目標ペースに並ぶ見込みです'
        : `目標ペースとの差は、あと ${gap} 秒/km（練習の平均は、目標より遅いのがふつうです）`,
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 画面に必ず添える、条件の但し書き。 */
export const OUTLOOK_NOTE =
  'いまの記録の傾きが、このまま続いた場合の見込みです。約束ではありません。体調・気温・生活の変化で簡単に変わります。';
