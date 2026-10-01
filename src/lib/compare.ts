/**
 * 同じくらいの練習を、過去の自分と比べる。
 *
 * **1本の練習をいくら詳しく見ても、「強くなったか」は言えない。**
 * 5:30/km・心拍148 が良いのか悪いのかは、その人の過去と比べて初めて決まる。
 *
 *     同じくらいの距離を、1〜3か月前は 5:42/km・心拍152 で走っていた。
 *     今日は 5:30/km・心拍148。同じ心拍で、1kmあたり12秒速い。
 *
 * **これは会話では絶対に出てこない。** 過去の練習を全部覚えていて、
 * そこから似たものを選んで平均を取る、という作業が要るため。
 * 毎回「3か月前はどうでしたか」と聞かれても、人は答えられない。
 *
 * ここが、チャットに貼り付けて相談するのとの、いちばん大きな差になる。
 */

import type { ActivityLog, RunnerProfile } from './types';

/** 比べてよい距離の幅。これより離れると、別の種類の練習になる。 */
const DISTANCE_TOLERANCE = 0.15;
/** これより短い練習は、流しやつなぎが混ざるので比べない。 */
const MIN_KM = 5;
/** 直前の数日と比べても、調子の上下しか見えない。これだけ離れた分と比べる。 */
const MIN_DAYS_APART = 21;
/** さかのぼる上限。古すぎると、別人の記録を比べているのと同じ。 */
const MAX_DAYS_APART = 120;
/** 平均を取るのに要る本数。1本だけでは、その日の調子で決まってしまう。 */
const MIN_SAMPLES = 2;
/** 効率の差を「変わった」と見なす境目(%)。測り方の誤差より大きいこと。 */
const MEANINGFUL_PERCENT = 2;

const DAY_MS = 86_400_000;

function paceSecOf(activity: ActivityLog): number | undefined {
  if (!activity.distanceKm || !activity.durationMin) return undefined;
  if (activity.distanceKm <= 0 || activity.durationMin <= 0) return undefined;
  const pace = (activity.durationMin * 60) / activity.distanceKm;
  // ありえない値は、読み取りの誤り。
  return pace > 120 && pace < 900 ? pace : undefined;
}

function timeOf(activity: ActivityLog): number {
  return Date.parse(`${(activity.date ?? '').slice(0, 10)}T12:00:00`);
}

export interface RunComparison {
  /** いまの練習。 */
  nowKm: number;
  nowPaceSec: number;
  nowHr?: number;
  /** 比べた相手（過去の似た練習の平均）。 */
  pastPaceSec: number;
  pastHr?: number;
  /** 平均を取った本数。 */
  samples: number;
  /** いちばん古い相手までの日数。 */
  fromDaysAgo: number;
  /** いちばん新しい相手までの日数。 */
  toDaysAgo: number;
  /** ペースの差（秒/km）。負なら速くなった。 */
  paceDeltaSec: number;
  /** 心拍の差（bpm）。負なら低くなった。両方に心拍がある時だけ。 */
  hrDelta?: number;
  /**
   * 同じ心拍あたりで、どれだけ前に進めるようになったか(%)。
   * **ペースだけでは分からない。** 心拍を上げて速く走っただけかもしれない。
   */
  efficiencyPercent?: number;
  verdict: 'better' | 'same' | 'harder';
}

/**
 * 似た練習と比べる。
 *
 * **1本とは比べない。** その日の体調・気温・風で、ペースは簡単に10秒動く。
 * 3週間〜4か月前の似た練習を集めて、平均と比べる。
 */
export function compareWithPast(
  profile: RunnerProfile | null | undefined,
  activity: ActivityLog,
): RunComparison | null {
  const km = activity.distanceKm;
  const pace = paceSecOf(activity);
  if (!km || km < MIN_KM || pace === undefined) return null;

  const at = timeOf(activity);
  if (Number.isNaN(at)) return null;

  const similar = (profile?.activities ?? []).filter((past) => {
    if (past.id === activity.id) return false;
    if (past.type !== activity.type) return false;
    const pastKm = past.distanceKm;
    if (!pastKm || pastKm < MIN_KM) return false;
    if (Math.abs(pastKm - km) / km > DISTANCE_TOLERANCE) return false;
    if (paceSecOf(past) === undefined) return false;
    const pastAt = timeOf(past);
    if (Number.isNaN(pastAt)) return false;
    const daysApart = (at - pastAt) / DAY_MS;
    return daysApart >= MIN_DAYS_APART && daysApart <= MAX_DAYS_APART;
  });

  if (similar.length < MIN_SAMPLES) return null;

  const paces = similar.map((past) => paceSecOf(past)!);
  const pastPaceSec = Math.round(paces.reduce((sum, value) => sum + value, 0) / paces.length);

  const pastHrs = similar
    .map((past) => past.metrics?.avgHr)
    .filter((value): value is number => value !== undefined && value > 60 && value < 230);
  // 半分以上に心拍があって初めて、平均として使う。
  const pastHr =
    pastHrs.length >= Math.ceil(similar.length / 2)
      ? Math.round(pastHrs.reduce((sum, value) => sum + value, 0) / pastHrs.length)
      : undefined;

  const nowHr = activity.metrics?.avgHr;
  const usableNowHr = nowHr !== undefined && nowHr > 60 && nowHr < 230 ? nowHr : undefined;

  const days = similar.map((past) => Math.round((at - timeOf(past)) / DAY_MS));
  const paceDeltaSec = Math.round(pace - pastPaceSec);

  let efficiencyPercent: number | undefined;
  if (pastHr !== undefined && usableNowHr !== undefined) {
    // 心拍1拍あたりに進める速さ。上がっていれば、同じ力で速く走れている。
    const before = 1 / pastPaceSec / pastHr;
    const after = 1 / pace / usableNowHr;
    efficiencyPercent = Math.round(((after - before) / before) * 1000) / 10;
  }

  const verdict: RunComparison['verdict'] =
    efficiencyPercent !== undefined
      ? efficiencyPercent > MEANINGFUL_PERCENT
        ? 'better'
        : efficiencyPercent < -MEANINGFUL_PERCENT
          ? 'harder'
          : 'same'
      : // 心拍が無い時は、ペースだけで見る。5秒/km を境目にする。
        paceDeltaSec < -5
        ? 'better'
        : paceDeltaSec > 5
          ? 'harder'
          : 'same';

  return {
    nowKm: Math.round(km * 10) / 10,
    nowPaceSec: Math.round(pace),
    nowHr: usableNowHr,
    pastPaceSec,
    pastHr,
    samples: similar.length,
    fromDaysAgo: Math.max(...days),
    toDaysAgo: Math.min(...days),
    paceDeltaSec,
    hrDelta:
      pastHr !== undefined && usableNowHr !== undefined ? usableNowHr - pastHr : undefined,
    efficiencyPercent,
    verdict,
  };
}

/** 秒/km を "5:30" に。 */
export function paceText(secondsPerKm: number): string {
  const whole = Math.round(secondsPerKm);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** ひと月ぶんの言い方。「35日前」より「1か月前」のほうが頭に入る。 */
function agoText(days: number): string {
  if (days < 45) return `${Math.round(days / 7)}週間前`;
  return `${Math.round(days / 30)}か月前`;
}

/**
 * 画面とプロンプトに出す言葉。
 *
 * **良くなった時だけ褒めない。** 落ちている時も同じ形で出す。
 * 都合のいい時だけ出す数字は、信用されなくなる。
 */
export function describeComparison(comparison: RunComparison): { title: string; detail: string } {
  const span =
    comparison.fromDaysAgo - comparison.toDaysAgo > 20
      ? `${agoText(comparison.fromDaysAgo)}〜${agoText(comparison.toDaysAgo)}`
      : agoText(comparison.toDaysAgo);

  const past =
    comparison.pastHr !== undefined
      ? `${paceText(comparison.pastPaceSec)}/km・心拍${comparison.pastHr}`
      : `${paceText(comparison.pastPaceSec)}/km`;
  const current =
    comparison.nowHr !== undefined
      ? `${paceText(comparison.nowPaceSec)}/km・心拍${comparison.nowHr}`
      : `${paceText(comparison.nowPaceSec)}/km`;

  const detail =
    `同じくらいの距離（${comparison.nowKm}km前後）を、${span}は ${past} で走っていました（${comparison.samples}本の平均）。` +
    `この練習は ${current}。`;

  switch (comparison.verdict) {
    case 'better':
      return {
        title:
          comparison.efficiencyPercent !== undefined
            ? `同じ心拍で、前より速く走れています`
            : `前より ${Math.abs(comparison.paceDeltaSec)}秒/km 速くなっています`,
        detail,
      };
    case 'harder':
      return {
        title: '前より、同じ距離がきつくなっています',
        detail: `${detail}疲れが残っているか、暑さや風の影響かもしれません。`,
      };
    case 'same':
      return { title: '前と同じくらいです', detail };
  }
}

/**
 * これより古い練習を、毎ターンの返事の材料にはしない。
 *
 * 2週間前の練習の比較を持ち出されると、「見ている」ではなく「古い話をしている」になる。
 */
const MAX_STALE_DAYS = 14;

/**
 * 比べる相手を探す対象。いちばん新しい、距離のある練習。
 *
 * 区間（ラップ）があるかは問わない。**スクリーンショット1枚でも、
 * 距離と時間が読めれば比べられる。** そこが区間解析との違い。
 */
function latestComparable(profile: RunnerProfile, now: Date): ActivityLog | null {
  for (let i = profile.activities.length - 1; i >= 0; i -= 1) {
    const activity = profile.activities[i];
    if ((activity.distanceKm ?? 0) < MIN_KM || paceSecOf(activity) === undefined) continue;
    const at = timeOf(activity);
    if (Number.isNaN(at)) continue;
    if ((now.getTime() - at) / DAY_MS > MAX_STALE_DAYS) return null;
    return activity;
  }
  return null;
}

/**
 * プロンプトに差し込む、過去の自分との比較。
 *
 * **数字はすべて計算済み。** モデルに過去の練習を数え直させると、
 * 似ていない練習を混ぜたり、平均を取り違えたまま断定する。
 *
 * ここを毎回の返事に入れることが、チャットに貼り付けて相談するのとの差になる。
 */
export function comparisonDoctrine(profile: RunnerProfile, now: Date = new Date()): string | null {
  const activity = latestComparable(profile, now);
  if (!activity) return null;

  const comparison = compareWithPast(profile, activity);
  if (!comparison) return null;

  const { title, detail } = describeComparison(comparison);
  const lines = [
    `# ${activity.date}の練習と、過去の自分との比較（**この数値は計算済み。自分で数え直さないこと**）`,
    `- ${detail}`,
  ];

  if (comparison.paceDeltaSec !== 0) {
    lines.push(
      comparison.paceDeltaSec < 0
        ? `- ペースは ${-comparison.paceDeltaSec}秒/km 速くなっている`
        : `- ペースは ${comparison.paceDeltaSec}秒/km 遅くなっている`,
    );
  }
  if (comparison.hrDelta !== undefined && comparison.hrDelta !== 0) {
    lines.push(
      comparison.hrDelta < 0
        ? `- 平均心拍は ${-comparison.hrDelta} 低い`
        : `- 平均心拍は ${comparison.hrDelta} 高い`,
    );
  }
  if (comparison.efficiencyPercent !== undefined) {
    lines.push(
      `- 同じ心拍あたりで進める量は ${comparison.efficiencyPercent > 0 ? '+' : ''}${comparison.efficiencyPercent}%` +
        '（ペース÷心拍の比。ペースだけでは、心拍を上げて速く走っただけかが分からない）',
    );
  }
  lines.push(`- 判定: ${title}`);

  lines.push(
    '- **この比較に、必ず一言触れること。** これは本人が自分では出せない数字で、',
    '  「過去の練習を覚えている相手に見てもらっている」という実感そのもの。',
    '- **落ちている時も、同じように出すこと。** 良くなった時だけ持ち出す数字は、信用されなくなる。',
    '  ただし落ちている時は、原因の候補（疲労・暑さ・風・睡眠・故障の前兆）を挙げ、責めないこと。',
    '- 比べた相手は「同じくらいの距離の、3週間〜4か月前の練習の平均」。',
    '  **期間や本数を勝手に言い換えないこと。** 上に書いてある通りに言う。',
  );
  return lines.join('\n');
}
