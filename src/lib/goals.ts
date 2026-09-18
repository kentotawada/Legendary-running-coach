import type { GoalKind, RunnerGoal, RunnerProfile } from './types';

/**
 * 指導理論（8割イージー・2割ポイント、心拍ゾーン、ピッチ）はどのレベルでも共通。
 * 変わるのは「基準となる数字」だけ。
 * ここでその人の目標から基準を導き、プロンプトへ渡す。
 */

export const MARATHON_KM = 42.195;

export interface GoalPreset {
  id: string;
  label: string;
  kind: GoalKind;
  /** 目標タイム。完走・健康維持のようにタイムを持たない目標もある。 */
  targetTime?: string;
  summary: string;
}

/**
 * 目標タイムの選択肢。1時間55分から5時間30分まで5分刻み。
 * 下限を2時間より手前に置いているのは、世界記録水準のランナーが設定できるようにするため。
 */
export const TARGET_TIME_MIN_SECONDS = 115 * 60;
export const TARGET_TIME_MAX_SECONDS = 330 * 60;
export const TARGET_TIME_STEP_SECONDS = 5 * 60;

/** 日本で広く使われている呼び名。それ以外は素直に「○時間○分」と出す。 */
const WELL_KNOWN_LABELS: Record<number, string> = {
  [120 * 60]: 'サブ2',
  [150 * 60]: 'サブ2.5',
  [180 * 60]: 'サブ3',
  [210 * 60]: 'サブ3.5',
  [240 * 60]: 'サブ4',
  [270 * 60]: 'サブ4.5',
  [300 * 60]: 'サブ5',
};

export interface TargetTimeOption {
  /** "3:00:00" 形式。 */
  value: string;
  /** "3時間00分（サブ3）" のような表示。 */
  label: string;
  seconds: number;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${`${m}`.padStart(2, '0')}:${`${s}`.padStart(2, '0')}`;
}

/** 目標タイムから、そのまま目標名として使える表現を作る。 */
export function summaryForTargetTime(seconds: number): string {
  const known = WELL_KNOWN_LABELS[seconds];
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const base = `フルマラソン ${h}時間${`${m}`.padStart(2, '0')}分切り`;
  return known ? `${base}（${known}）` : base;
}

export function targetTimeOptions(): TargetTimeOption[] {
  const options: TargetTimeOption[] = [];
  for (
    let seconds = TARGET_TIME_MIN_SECONDS;
    seconds <= TARGET_TIME_MAX_SECONDS;
    seconds += TARGET_TIME_STEP_SECONDS
  ) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const known = WELL_KNOWN_LABELS[seconds];
    options.push({
      value: formatDuration(seconds),
      seconds,
      label: `${h}時間${`${m}`.padStart(2, '0')}分${known ? `（${known}）` : ''}`,
    });
  }
  return options;
}

export const GOAL_PRESETS: GoalPreset[] = [
  { id: 'sub3', label: 'サブ3', kind: 'time', targetTime: '2:59:59', summary: 'フルマラソン サブ3（3時間切り）' },
  { id: 'sub315', label: 'サブ3.25', kind: 'time', targetTime: '3:14:59', summary: 'フルマラソン 3時間15分切り' },
  { id: 'sub330', label: 'サブ3.5', kind: 'time', targetTime: '3:29:59', summary: 'フルマラソン サブ3.5（3時間30分切り）' },
  { id: 'sub4', label: 'サブ4', kind: 'time', targetTime: '3:59:59', summary: 'フルマラソン サブ4（4時間切り）' },
  { id: 'sub430', label: 'サブ4.5', kind: 'time', targetTime: '4:29:59', summary: 'フルマラソン サブ4.5（4時間30分切り）' },
  { id: 'sub5', label: 'サブ5', kind: 'time', targetTime: '4:59:59', summary: 'フルマラソン サブ5（5時間切り）' },
  { id: 'finish', label: '完走したい', kind: 'race', summary: 'フルマラソン完走' },
  { id: 'health', label: '健康維持・習慣化', kind: 'health', summary: '健康維持と走る習慣の定着' },
];

/** "3:29:59" や "29:30" を秒に直す。読めなければ undefined。 */
export function parseDuration(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parts = value.trim().split(':');
  if (parts.length < 2 || parts.length > 3) return undefined;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((n) => !Number.isFinite(n) || n < 0)) return undefined;
  const [h, m, s] = parts.length === 3 ? numbers : [0, numbers[0], numbers[1]];
  if (m >= 60 || s >= 60) return undefined;
  return h * 3600 + m * 60 + s;
}

/**
 * 秒/km を "4:15/km" の形に。**切り上げではなく切り捨てる。**
 * 3時間切りに必要なペースは 4:15.9/km だが、これを四捨五入して 4:16 と伝えると、
 * その通りに走った人は 3:00:21 でゴールしてしまう。目標ペースは速い側に丸める。
 */
export function formatPace(secondsPerKm: number): string {
  const floored = Math.floor(secondsPerKm);
  const m = Math.floor(floored / 60);
  const s = `${floored % 60}`.padStart(2, '0');
  return `${m}:${s}/km`;
}

/** 目標タイムからフルマラソンの必要ペース（秒/km）を出す。 */
export function marathonPaceSeconds(targetTime: string | undefined): number | undefined {
  const seconds = parseDuration(targetTime);
  if (seconds === undefined || seconds <= 0) return undefined;
  return seconds / MARATHON_KM;
}

/**
 * Daniels の式による VDOT（走能力の推定値）。
 * 目標タイムだけで強度の絶対値が決まるため、
 * サブ5でも世界記録水準でも同じ物差しで話せるようになる。
 *
 *   VO2   = -4.60 + 0.182258·v + 0.000104·v²      (v は m/分)
 *   %VO2max = 0.8 + 0.1894393·e^(-0.012778·t) + 0.2989558·e^(-0.1932605·t)  (t は分)
 */
export function estimateVdot(distanceMeters: number, seconds: number): number | undefined {
  if (!(distanceMeters > 0) || !(seconds > 0)) return undefined;
  const minutes = seconds / 60;
  const velocity = distanceMeters / minutes;
  const vo2 = -4.6 + 0.182258 * velocity + 0.000104 * velocity * velocity;
  const percentMax =
    0.8 + 0.1894393 * Math.exp(-0.012778 * minutes) + 0.2989558 * Math.exp(-0.1932605 * minutes);
  if (percentMax <= 0) return undefined;
  return vo2 / percentMax;
}

/** 目標タイムからの VDOT。 */
export function vdotForTarget(targetTime: string | undefined): number | undefined {
  const seconds = parseDuration(targetTime);
  if (seconds === undefined) return undefined;
  return estimateVdot(MARATHON_KM * 1000, seconds);
}

export interface TrainingPaces {
  /** レースペース（M）。 */
  marathon: string;
  /** イージー（E）の下限〜上限。 */
  easyFrom: string;
  easyTo: string;
  /** 閾値走（T）。 */
  threshold: string;
  /** インターバル（I）。 */
  interval: string;
}

/**
 * レースペースを起点に各強度を導く。
 * 比率で置くことで、サブ3でもサブ5でも同じ理屈が成り立つようにしている。
 */
export function trainingPaces(marathonPaceSec: number): TrainingPaces {
  return {
    marathon: formatPace(marathonPaceSec),
    easyFrom: formatPace(marathonPaceSec * 1.25),
    easyTo: formatPace(marathonPaceSec * 1.4),
    threshold: formatPace(marathonPaceSec * 0.955),
    interval: formatPace(marathonPaceSec * 0.885),
  };
}

export interface VolumeGuide {
  weeklyKm: string;
  pointSessions: string;
}

/** 目標に見合った走行距離とポイント練習の頻度。 */
export function volumeGuide(goal: RunnerGoal | undefined): VolumeGuide {
  if (!goal || goal.kind === 'health' || goal.kind === 'habit') {
    return {
      weeklyKm: '距離のノルマは置かない（続けられる範囲が正解）',
      pointSessions: 'ポイント練習は必須ではない。走ること自体を楽しめる強度を優先する',
    };
  }
  const seconds = parseDuration(goal.targetTime);
  if (seconds === undefined) {
    return { weeklyKm: '週25〜35km', pointSessions: '週1回（距離への耐性づくりを優先）' };
  }
  // サブ3で頭打ちにすると、2時間台のランナーに現実離れした少なさを勧めてしまう。
  if (seconds < 2.25 * 3600) {
    return {
      weeklyKm: '週160〜220km（プロ／実業団水準。1日2部練習が前提）',
      pointSessions: '週2〜3回。ポイント間にジョグを厚く挟み、総量で支える',
    };
  }
  if (seconds < 2.5 * 3600) {
    return { weeklyKm: '週130〜180km（1日2部練習を含む）', pointSessions: '週2〜3回' };
  }
  if (seconds < 2.75 * 3600) {
    return { weeklyKm: '週100〜140km', pointSessions: '週2〜3回' };
  }
  if (seconds < 3 * 3600) return { weeklyKm: '週60〜80km（月間250〜350km）', pointSessions: '週2回まで、中2日空ける' };
  if (seconds < 3.5 * 3600) return { weeklyKm: '週50〜70km', pointSessions: '週2回まで、中2日空ける' };
  if (seconds < 4 * 3600) return { weeklyKm: '週40〜55km', pointSessions: '週1〜2回' };
  if (seconds < 4.5 * 3600) return { weeklyKm: '週35〜45km', pointSessions: '週1〜2回' };
  return { weeklyKm: '週30〜40km', pointSessions: '週1回' };
}

/** 目標ペース。手動設定があればそれを優先する。 */
export function resolveTargetPace(goal: RunnerGoal | undefined): string | undefined {
  if (!goal) return undefined;
  if (goal.targetPace) return goal.targetPace;
  const pace = marathonPaceSeconds(goal.targetTime);
  return pace === undefined ? undefined : formatPace(pace);
}

/**
 * プロンプトに差し込む「この人の基準」。
 * 目標が決まっていなければ、数字を出す前に尋ねさせる。
 */
export function goalDoctrine(profile: RunnerProfile): string {
  const goal = profile.goal;

  if (!goal || goal.kind === 'none') {
    return [
      '# この人の基準',
      '- 目標がまだ決まっていない。**ペース基準を出す前に、まず目標を尋ねること。**',
      '  （サブ3 / サブ3.5 / サブ4 / 完走 / 健康維持 など。フルマラソン以外でもよい）',
      '- 直近のフルまたはハーフのタイムと、週間走行距離も併せて聞く。',
      '- 「カルテ」画面からいつでも目標を設定・変更できることを、一度だけ案内する。',
    ].join('\n');
  }

  if (goal.kind === 'health' || goal.kind === 'habit') {
    const volume = volumeGuide(goal);
    return [
      '# この人の基準',
      `- 目標: ${goal.summary}`,
      '- **タイムとノルマを前面に出さない。** 走った事実と、走った後の感覚を評価軸にする。',
      `- ${volume.weeklyKm}`,
      `- ${volume.pointSessions}`,
      '- 心拍・ピッチの評価は行ってよいが、「速くするため」ではなく「楽に長く走るため」の文脈で伝える。',
    ].join('\n');
  }

  const paceOverride = goal.targetPace;
  const derived = marathonPaceSeconds(goal.targetTime);
  const volume = volumeGuide(goal);
  const lines = ['# この人の基準', `- 目標: ${goal.summary}`];

  if (goal.raceName || goal.raceDate) {
    lines.push(`- 本番: ${[goal.raceName, goal.raceDate].filter(Boolean).join(' / ')}`);
  }

  if (derived !== undefined) {
    const paces = trainingPaces(derived);
    const vdot = vdotForTarget(goal.targetTime);

    lines.push(
      `- **目標ペース（M）= ${paceOverride ?? paces.marathon}**。すべての練習をこの基準との距離で評価する。`,
      `- イージー（E）: ${paces.easyFrom} 〜 ${paces.easyTo}。鼻呼吸で会話できる強度。遅すぎることを恐れさせない。`,
      `- 閾値走（T）: ${paces.threshold} 前後を20〜40分。LTHR付近。「きついが単語なら話せる」。`,
      `- インターバル（I）: ${paces.interval} 前後で3〜5分×5本程度。レース前の一時期に限定する。`,
      `- レースペース走（M）: ${paceOverride ?? paces.marathon}。ロング走の後半に入れると本番の再現度が上がる。`,
    );

    if (vdot !== undefined) {
      lines.push(
        `- **この目標に必要な VDOT ≒ ${vdot.toFixed(1)}**（Daniels の推定値）。`,
        '  実走データから推定した現在の VDOT と比べ、開きがあるならどの能力が不足しているかを specific に指摘する。',
      );
    }

    // 2時間30分を切る水準では、市民ランナー向けの前提がそのままでは通用しない。
    if (derived < 215) {
      lines.push(
        '- **このランナーは世界記録に近い水準にいる。** 市民ランナー向けの一般論をそのまま当てないこと。',
        '  1日2部練習、ジョグの絶対量、鉄・フェリチンを含む血液指標、体重管理の許容幅の狭さ、',
        '  シューズとレース選択、ペーサーの有無まで含めて、この水準の文脈で話すこと。',
        '  この領域では「もっと追い込む」より「回復と総量の管理」が伸びしろになることが多い。',
      );
    }
  } else if (paceOverride) {
    lines.push(`- **目標ペース（M）= ${paceOverride}**。すべての練習をこの基準との距離で評価する。`);
  } else {
    lines.push(
      '- 目標タイムが未設定のため、ペース基準を計算できない。',
      '  完走が目標なら、ペースより「止まらずに動き続けられる時間」を評価軸にする。',
    );
  }

  lines.push(`- 走行距離の目安: ${volume.weeklyKm}。増やすのは前週比10%以内。`, `- ポイント練習: ${volume.pointSessions}`);

  return lines.join('\n');
}
