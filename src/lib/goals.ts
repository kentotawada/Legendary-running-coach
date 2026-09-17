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
    lines.push(
      `- **目標ペース（M）= ${paceOverride ?? paces.marathon}**。すべての練習をこの基準との距離で評価する。`,
      `- イージー（E）: ${paces.easyFrom} 〜 ${paces.easyTo}。鼻呼吸で会話できる強度。遅すぎることを恐れさせない。`,
      `- 閾値走（T）: ${paces.threshold} 前後を20〜40分。LTHR付近。「きついが単語なら話せる」。`,
      `- インターバル（I）: ${paces.interval} 前後で3〜5分×5本程度。レース前の一時期に限定する。`,
      `- レースペース走（M）: ${paceOverride ?? paces.marathon}。ロング走の後半に入れると本番の再現度が上がる。`,
    );
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
