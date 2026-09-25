/**
 * 1本の練習の「中身」を読む層。
 *
 * 平均だけを見ていると、まるで違う走りが同じ数字になります。
 * 「1km×5本」を平均ペースで見ると、1本目から突っ込んで最後に垂れた走りも、
 * 最後まで刻んだ走りも、同じ4分00秒。**指導が変わるのは、そこなのに。**
 *
 * ここで計算するのは、区間の並びからしか出てこない数字です。
 * スクリーンショットの画面には出ていないし、平均からは復元できません。
 *
 * **計算はすべてコードで行い、モデルには数え直させません。**
 * 桁を間違えた分析は、無いほうがましだからです。
 */

import type { ActivityLap, ActivityLog } from './types';
import { formatPace } from './goals';

export type RunShape = 'steady' | 'intervals' | 'progression' | 'fade' | 'unknown';

export interface RunAnalysis {
  lapCount: number;
  /** 前半・後半の平均心拍。 */
  firstHalfHr?: number;
  secondHalfHr?: number;
  /** 後半の平均ペース − 前半の平均ペース（秒/km）。プラスなら後半が遅い。 */
  paceFadeSec?: number;
  /**
   * 心拍ドリフト（%）。
   *
   * 同じ速度を保つのに、後半どれだけ心拍が上振れたか。
   * 暑さ・脱水・持久力の不足が、ここに出ます。
   * 数値の意味づけ（何%から問題か）は、コーチが状況を見て決めます。
   */
  decouplingPercent?: number;
  shape: RunShape;
  /** インターバルと判定した時の、速い区間だけの中身。 */
  reps?: { count: number; pace: string; avgHr?: number; restPace?: string };
}

/** 区間のペース（秒/km）。距離か時間が無い区間は、並びから外す。 */
function paceSec(lap: ActivityLap): number | undefined {
  if (lap.distanceKm <= 0 || lap.durationSec <= 0) return undefined;
  return lap.durationSec / lap.distanceKm;
}

interface Half {
  distanceKm: number;
  durationSec: number;
  hr?: number;
}

/** 距離の真ん中で前半と後半に割る。本数で割ると、長さの違う区間で歪む。 */
function halves(laps: ActivityLap[]): [Half, Half] | null {
  const total = laps.reduce((sum, lap) => sum + lap.distanceKm, 0);
  if (total <= 0) return null;

  const make = (): Half => ({ distanceKm: 0, durationSec: 0 });
  const first = make();
  const second = make();
  let firstHrWeighted = 0;
  let firstHrSec = 0;
  let secondHrWeighted = 0;
  let secondHrSec = 0;
  let covered = 0;

  for (const lap of laps) {
    const target = covered + lap.distanceKm / 2 <= total / 2 ? first : second;
    target.distanceKm += lap.distanceKm;
    target.durationSec += lap.durationSec;
    if (lap.avgHr !== undefined) {
      if (target === first) {
        firstHrWeighted += lap.avgHr * lap.durationSec;
        firstHrSec += lap.durationSec;
      } else {
        secondHrWeighted += lap.avgHr * lap.durationSec;
        secondHrSec += lap.durationSec;
      }
    }
    covered += lap.distanceKm;
  }

  if (first.distanceKm <= 0 || second.distanceKm <= 0) return null;
  if (firstHrSec > 0) first.hr = firstHrWeighted / firstHrSec;
  if (secondHrSec > 0) second.hr = secondHrWeighted / secondHrSec;
  return [first, second];
}

/**
 * 速い区間・遅い区間の仕分け。
 *
 * **中央値を基準にしない。** 「1km×4本 + つなぎ3本」のように本数が偏ると、
 * 中央値そのものが速い側に寄り、速い区間が1本も無いことになってしまう。
 * 最も速い区間と最も遅い区間の幅で切る。
 */
const FAST_EDGE = 0.35;
const SLOW_EDGE = 0.65;
/** この幅より狭いばらつきは、ただの揺れ。練習の設計ではない。 */
const VARIED_RATIO = 0.15;
/** ここを超える後半の落ち込みは、「垂れた」と呼んでよい幅。 */
const FADE_SEC = 15;
/** 速い・遅いが何度入れ替わればインターバルと呼ぶか。 */
const MIN_ALTERNATIONS = 3;

interface Classified {
  fast: boolean[];
  slow: boolean[];
  varied: boolean;
  alternations: number;
}

function classify(paces: number[]): Classified {
  const min = Math.min(...paces);
  const max = Math.max(...paces);
  const range = max - min;
  const fast = paces.map((pace) => pace <= min + range * FAST_EDGE);
  const slow = paces.map((pace) => pace >= min + range * SLOW_EDGE);

  // 速い→遅い→速い、と行き来した回数。
  // ビルドアップのように一方向に変わるだけの走りを、インターバルと呼ばないため。
  let alternations = 0;
  let previous: 'fast' | 'slow' | null = null;
  paces.forEach((_, index) => {
    const current = fast[index] ? 'fast' : slow[index] ? 'slow' : null;
    if (!current) return;
    if (previous && previous !== current) alternations += 1;
    previous = current;
  });

  return { fast, slow, varied: min > 0 && range / min >= VARIED_RATIO, alternations };
}

function shapeOf(paces: number[]): RunShape {
  if (paces.length < 3) return 'unknown';
  const { fast, slow, varied, alternations } = classify(paces);

  const fastCount = fast.filter(Boolean).length;
  const slowCount = slow.filter(Boolean).length;
  if (varied && fastCount >= 2 && slowCount >= 2 && alternations >= MIN_ALTERNATIONS) {
    return 'intervals';
  }

  // 3等分して、順に速くなっていれば、ビルドアップ。
  const third = Math.floor(paces.length / 3);
  if (third >= 1) {
    const mean = (list: number[]) => list.reduce((sum, value) => sum + value, 0) / list.length;
    const head = mean(paces.slice(0, third));
    const tail = mean(paces.slice(-third));
    if (tail < head * 0.95) return 'progression';
    if (tail - head > FADE_SEC) return 'fade';
  }
  return 'steady';
}

/** 速い区間だけをまとめる。「何本を、どのペースで、心拍いくつで踏めたか」。 */
function repsOf(laps: ActivityLap[], paces: number[]): RunAnalysis['reps'] {
  const { fast, slow } = classify(paces);
  const quick = laps.filter((_, index) => fast[index]);
  const rest = laps.filter((_, index) => slow[index]);
  if (quick.length === 0) return undefined;

  const km = quick.reduce((sum, lap) => sum + lap.distanceKm, 0);
  const sec = quick.reduce((sum, lap) => sum + lap.durationSec, 0);
  const withHr = quick.filter((lap) => lap.avgHr !== undefined);
  const restKm = rest.reduce((sum, lap) => sum + lap.distanceKm, 0);
  const restSec = rest.reduce((sum, lap) => sum + lap.durationSec, 0);
  if (km <= 0 || sec <= 0) return undefined;

  return {
    count: quick.length,
    pace: formatPace(sec / km),
    avgHr:
      withHr.length > 0
        ? Math.round(withHr.reduce((sum, lap) => sum + (lap.avgHr ?? 0), 0) / withHr.length)
        : undefined,
    restPace: restKm > 0 && restSec > 0 ? formatPace(restSec / restKm) : undefined,
  };
}

/** 区間の並びから、平均では見えないものを取り出す。 */
export function analyze(activity: ActivityLog): RunAnalysis | null {
  const laps = (activity.laps ?? []).filter((lap) => paceSec(lap) !== undefined);
  if (laps.length < 2) return null;

  const paces = laps.map((lap) => paceSec(lap)!);
  const split = halves(laps);

  let paceFadeSec: number | undefined;
  let decouplingPercent: number | undefined;
  if (split) {
    const [first, second] = split;
    const pace1 = first.durationSec / first.distanceKm;
    const pace2 = second.durationSec / second.distanceKm;
    paceFadeSec = Math.round(pace2 - pace1);

    // 速度 ÷ 心拍 の比が、後半どれだけ落ちたか。走る世界で言う「デカップリング」。
    if (first.hr && second.hr) {
      const ratio1 = first.distanceKm / first.durationSec / first.hr;
      const ratio2 = second.distanceKm / second.durationSec / second.hr;
      if (ratio1 > 0) decouplingPercent = Math.round(((ratio1 - ratio2) / ratio1) * 1000) / 10;
    }
  }

  const shape = shapeOf(paces);

  return {
    lapCount: laps.length,
    firstHalfHr: split?.[0].hr !== undefined ? Math.round(split[0].hr) : undefined,
    secondHalfHr: split?.[1].hr !== undefined ? Math.round(split[1].hr) : undefined,
    paceFadeSec,
    decouplingPercent,
    shape,
    reps: shape === 'intervals' ? repsOf(laps, paces) : undefined,
  };
}

const SHAPE_LABEL: Record<RunShape, string> = {
  steady: '一定ペース',
  intervals: 'インターバル（速い区間と遅い区間の繰り返し）',
  progression: 'ビルドアップ（後半に上げている）',
  fade: '後半に落ちている',
  unknown: '判定できず',
};

/** 区間を全部並べると長い。多い時は、意味の変わり目が分かる程度に間引く。 */
const MAX_LAP_LINES = 24;

export function lapTable(laps: ActivityLap[]): string[] {
  const step = Math.max(1, Math.ceil(laps.length / MAX_LAP_LINES));
  const lines: string[] = [];

  for (let i = 0; i < laps.length; i += step) {
    const lap = laps[i];
    const parts = [`${lap.index})`, `${lap.distanceKm}km`, lap.pace ?? ''];
    if (lap.avgHr !== undefined) parts.push(`心拍${lap.avgHr}`);
    if (lap.maxHr !== undefined && lap.maxHr !== lap.avgHr) parts.push(`最高${lap.maxHr}`);
    if (lap.cadence !== undefined) parts.push(`${lap.cadence}spm`);
    lines.push(parts.filter(Boolean).join(' '));
  }

  if (step > 1) lines.push(`（${laps.length}区間のうち${lines.length}本を抜粋）`);
  return lines;
}

/**
 * プロンプトに差し込む、直近の練習の中身。
 *
 * ここに出す数字は**すべて計算済み**。モデルに数え直させると、
 * 桁を間違えたまま断定する事故が起きる。
 */
export function runDoctrine(activity: ActivityLog): string | null {
  const laps = activity.laps ?? [];
  if (laps.length < 2) return null;
  const analysis = analyze(activity);
  if (!analysis) return null;

  const lines = [
    `# ${activity.date}の練習の中身（区間ごと。**この数値は計算済み。自分で数え直さないこと**）`,
    ...lapTable(laps).map((line) => `- ${line}`),
    `- 形: ${SHAPE_LABEL[analysis.shape]}`,
  ];

  if (analysis.reps) {
    const rep = analysis.reps;
    const detail = [`速い区間${rep.count}本`, `平均${rep.pace}`];
    if (rep.avgHr !== undefined) detail.push(`平均心拍${rep.avgHr}`);
    if (rep.restPace) detail.push(`つなぎ${rep.restPace}`);
    lines.push(`- ${detail.join(' / ')}`);
  }

  if (analysis.firstHalfHr !== undefined && analysis.secondHalfHr !== undefined) {
    const diff = analysis.secondHalfHr - analysis.firstHalfHr;
    lines.push(
      `- 前半の平均心拍 ${analysis.firstHalfHr} → 後半 ${analysis.secondHalfHr}（${diff >= 0 ? '+' : ''}${diff}）`,
    );
  }
  if (analysis.paceFadeSec !== undefined) {
    lines.push(
      analysis.paceFadeSec >= 0
        ? `- 後半のペースは前半より ${analysis.paceFadeSec}秒/km 遅い`
        : `- 後半のペースは前半より ${-analysis.paceFadeSec}秒/km 速い`,
    );
  }
  if (analysis.decouplingPercent !== undefined) {
    lines.push(
      `- 心拍ドリフト ${analysis.decouplingPercent > 0 ? '+' : ''}${analysis.decouplingPercent}%` +
        '（同じ速度に対して後半の心拍がどれだけ上振れたか）',
    );
  }

  const form = formLines(activity);
  if (form.length > 0) lines.push(...form);

  lines.push(
    '- **区間の並びから読み取れることを、必ず一言入れること。** 平均だけを褒めない。',
    '  入り方が速すぎなかったか、最後まで刻めたか、心拍がどこから上がったか——',
    '  そこが、スクリーンショットを見ただけでは言えない部分。',
  );
  return lines.join('\n');
}

/**
 * フォームの指標。**FIT ファイルからしか入ってこない。**
 *
 * 値の良し悪しは、身長・脚の長さ・走る速度で変わる。
 * **一般的な目安を当てはめて断定しない。** 見るのは、その人の中での変化。
 */
function formLines(activity: ActivityLog): string[] {
  const metrics = activity.metrics;
  if (!metrics) return [];

  const values: string[] = [];
  if (metrics.powerW !== undefined) values.push(`ランニングパワー ${metrics.powerW}W`);
  if (metrics.verticalOscillationCm !== undefined) values.push(`上下動 ${metrics.verticalOscillationCm}cm`);
  if (metrics.groundContactMs !== undefined) values.push(`接地時間 ${metrics.groundContactMs}ms`);
  if (metrics.verticalRatio !== undefined) values.push(`上下動比 ${metrics.verticalRatio}%`);
  if (metrics.stepLengthCm !== undefined) values.push(`歩幅 ${metrics.stepLengthCm}cm`);
  if (metrics.balanceLeft !== undefined) {
    const right = Math.round((100 - metrics.balanceLeft) * 10) / 10;
    values.push(`接地の左右バランス 左${metrics.balanceLeft}% / 右${right}%`);
  }
  if (values.length === 0) return [];

  const lines = [`- フォームの指標: ${values.join(' / ')}`];

  // 左右差は、故障につながる形で出ていることがある。ただし断定はしない。
  if (metrics.balanceLeft !== undefined && Math.abs(metrics.balanceLeft - 50) >= 2) {
    const heavier = metrics.balanceLeft > 50 ? '左' : '右';
    lines.push(
      `- **接地時間が${heavier}に${Math.abs(Math.round((metrics.balanceLeft - 50) * 10) / 10)}%偏っている。**`,
      '  痛みの訴えがある側と一致するなら、そこは触れる価値がある。',
      '  **一致しないなら、左右差だけを理由に故障を予言しないこと。** 誰にでも多少の差はある。',
    );
  }

  lines.push(
    '- **上下動・接地時間・歩幅に、一般的な「良い数値」を当てはめないこと。**',
    '  身長・脚の長さ・走る速度で基準が変わる。見るのは、この人の中での変化と、速度との関係。',
  );
  return lines;
}
