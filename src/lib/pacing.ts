/**
 * 大会当日の、通過タイム。
 *
 * **「前半を抑えて」は、助言ではない。**
 * 抑えるのは誰でも分かっている。分からないのは「じゃあ最初の5kmは何分何秒で入るのか」。
 * そこを言わないまま送り出すから、スタートの熱気で30秒速く入って、30kmで止まる。
 *
 * 時計のペース配分機能は、平らな目標ペースをそのまま刻ませる。
 * ここが違うのは3つ。
 *
 *  1. **前半を意図的に遅く置く。** 市民ランナーの失敗は、ほぼ全部が突っ込みすぎ
 *  2. **当日の暑さで、目標そのものを置き直す。** 25度の日にサブ3.5の表を渡すのは嘘
 *  3. **崩れた時に何をするかを、先に決めておく。** 崩れてから考えると、たいてい歩く
 *
 * ## やらないこと
 *
 * - **秒まで刻んだ表を信じさせない。** 出すのは通過の目安で、GPSは1kmごとにずれる。
 * - **目標を勝手に下げない。** 暑い日の見込みは出すが、本人の目標はそのまま残す。
 */

import type { RaceEntry, RunnerProfile } from './types';
import { formatDuration, formatPace, parseDuration } from './goals';
import { raceDistanceKm } from './gear-spec';
import { daysUntil, targetRace } from './races';
import { heatAdvice, isFresh } from './weather';

/** 何日前から出すか。**前日に初めて見るのでは、練習で試せない。** */
export const PACING_FROM_DAYS = 14;

/**
 * 前半をどれだけ抑えるか。
 *
 * 最初の5kmを目標ペースより遅く入り、そのぶんを後半で返す（ネガティブスプリット）。
 * **数字は控えめに置く。** 大きく振ると、途中で「遅れている」と感じて突っ込む。
 */
const OPENING_SLOWER_SEC = 8;
/** 中盤（全体の1/4〜3/4）は、目標ペースちょうど。 */
const MIDDLE_SLOWER_SEC = 0;
/** 終盤は、貯金を返しに行く。 */
const CLOSING_FASTER_SEC = 3;

export interface PaceSplit {
  /** 通過地点(km)。 */
  km: number;
  /** その区間のペース（"4:58/km"）。 */
  pace: string;
  /** スタートからの通過タイム（"25:30"）。 */
  elapsed: string;
  /** 区間の呼び名。 */
  phase: '入り' | '中盤' | '終盤';
}

export interface PacePlan {
  race: RaceEntry;
  distanceKm: number;
  daysLeft: number;
  /** 本人の目標タイム。**暑くても、これは書き換えない。** */
  targetTime: string;
  targetPaceSec: number;
  splits: PaceSplit[];
  /** 当日の暑さで置き直した見込み。暑くない日は undefined。 */
  heat?: { headline: string; adjustedTime: string; adjustedPace: string };
  /** 崩れた時にどうするか。 */
  ifItBreaks: { when: string; what: string }[];
  note: string;
}

/** 通過の刻み。距離に合わせて、読める数に抑える。 */
function stepFor(distanceKm: number): number {
  if (distanceKm > 30) return 5;
  if (distanceKm > 12) return 5;
  if (distanceKm > 6) return 2;
  return 1;
}

function clock(seconds: number): string {
  const whole = Math.round(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** その区間のペース（秒/km）。前半は遅く、終盤は速く。 */
function paceAt(km: number, distanceKm: number, targetPaceSec: number): number {
  const ratio = km / distanceKm;
  if (ratio <= 0.25) return targetPaceSec + OPENING_SLOWER_SEC;
  if (ratio <= 0.75) return targetPaceSec + MIDDLE_SLOWER_SEC;
  return targetPaceSec - CLOSING_FASTER_SEC;
}

function phaseAt(km: number, distanceKm: number): PaceSplit['phase'] {
  const ratio = km / distanceKm;
  if (ratio <= 0.25) return '入り';
  if (ratio <= 0.75) return '中盤';
  return '終盤';
}

/**
 * 大会当日のペース配分。
 * 目標タイムと距離が分からなければ null。**無いものから表を作らない。**
 */
export function pacePlan(profile: RunnerProfile, now: Date = new Date()): PacePlan | null {
  const race = targetRace(profile, now);
  if (!race) return null;

  const daysLeft = daysUntil(race.date, now);
  if (daysLeft === undefined || daysLeft < 0 || daysLeft > PACING_FROM_DAYS) return null;

  const distanceKm = raceDistanceKm(race);
  if (!distanceKm || distanceKm <= 0) return null;

  // 大会の目標があればそれを、無ければ全体の目標を使う。
  const targetSeconds = parseDuration(race.targetTime) ?? parseDuration(profile.goal?.targetTime);
  if (targetSeconds === undefined || targetSeconds <= 0) return null;

  const targetPaceSec = targetSeconds / distanceKm;
  const step = stepFor(distanceKm);

  /*
    区間ごとのペースを、まず形だけで置く。

    **そのままでは、合計が目標とずれる。**
    入りを遅く、終盤を速くした分は、きれいには相殺されない。
    目標3:30:00の表の最後が 3:30:43 になっていたら、見た人は数字を信じない。
    形は保ったまま、全体を引き伸ばして合計をちょうどに合わせる。
  */
  const segments: { km: number; chunk: number; raw: number; phase: PaceSplit['phase'] }[] = [];
  let covered = 0;
  while (covered < distanceKm - 0.01) {
    const next = Math.min(covered + step, distanceKm);
    const chunk = next - covered;
    const middle = covered + chunk / 2;
    segments.push({
      km: Math.round(next * 100) / 100,
      chunk,
      raw: paceAt(middle, distanceKm, targetPaceSec),
      phase: phaseAt(middle, distanceKm),
    });
    covered = next;
  }

  const rawTotal = segments.reduce((sum, segment) => sum + segment.raw * segment.chunk, 0);
  const scale = rawTotal > 0 ? targetSeconds / rawTotal : 1;

  const splits: PaceSplit[] = [];
  let elapsed = 0;
  for (const segment of segments) {
    const pace = segment.raw * scale;
    elapsed += pace * segment.chunk;
    splits.push({
      km: segment.km,
      pace: formatPace(pace),
      elapsed: clock(elapsed),
      phase: segment.phase,
    });
  }

  /*
    当日の暑さ。**目標は書き換えない。**
    書き換えると、涼しかった時に何を目指していたか分からなくなる。
    置くのは「この気温なら、これくらいが同じきつさ」という見込みだけ。
  */
  let heat: PacePlan['heat'];
  if (isFresh(profile.weather, now)) {
    const advice = heatAdvice(profile.weather!, Math.round(targetPaceSec));
    if (advice.level !== 'none' && advice.level !== 'cold' && advice.slowPercent > 0) {
      const adjustedSeconds = targetSeconds * (1 + advice.slowPercent / 100);
      heat = {
        headline: advice.headline,
        adjustedTime: formatDuration(Math.round(adjustedSeconds)),
        adjustedPace: formatPace(adjustedSeconds / distanceKm),
      };
    }
  }

  const half = Math.round(distanceKm / 2);
  const late = Math.round(distanceKm * 0.7);

  return {
    race,
    distanceKm,
    daysLeft,
    targetTime: formatDuration(targetSeconds),
    targetPaceSec: Math.round(targetPaceSec),
    splits,
    heat,
    ifItBreaks: [
      {
        when: `${late}km を過ぎて、1kmあたり20秒以上落ちた時`,
        what: '記録はそこで諦めて、完走に切り替える。歩いてもいいので、止まらずに進む',
      },
      {
        when: '前半で、表より30秒以上速く通過した時',
        what: 'そこから意識して落とす。貯金ではありません。後半に倍で返ってきます',
      },
      {
        when: '脚がつりそうな時',
        what: '止まって伸ばすより、歩幅を小さくして回す。塩分が取れるなら取る',
      },
      {
        when: '胸が痛い・めまい・急に汗が止まった時',
        what: 'すぐにやめて、係員へ。これだけは、記録とは比べません',
      },
    ],
    note:
      `最初の${Math.round(distanceKm * 0.25)}kmは、目標より1kmあたり${OPENING_SLOWER_SEC}秒遅く置いてあります。` +
      '抑えて入ったぶんは、後半に返ってきます。周りに抜かれても、ここは守ってください。' +
      `折り返し（${half}km）で表どおりなら、計算は合っています。`,
  };
}

/**
 * プロンプトに差し込む、当日のペース配分。
 * **画面に出ている表と、コーチの言う数字を食い違わせない。**
 */
export function pacingDoctrine(profile: RunnerProfile, now: Date = new Date()): string | null {
  const plan = pacePlan(profile, now);
  if (!plan) return null;

  const lines = [
    `# 画面に出ている「${plan.race.name}のペース配分」（**本人はもう見ている**）`,
    `- ${plan.distanceKm}km / 目標 ${plan.targetTime}（1kmあたり ${formatPace(plan.targetPaceSec)}）`,
    `- 入りは目標より1kmあたり${OPENING_SLOWER_SEC}秒遅く、終盤で${CLOSING_FASTER_SEC}秒速く置いてある`,
    `- 通過の目安: ${plan.splits
      .filter((split, index) => index === 0 || split.km % 10 === 0 || index === plan.splits.length - 1)
      .map((split) => `${split.km}km ${split.elapsed}`)
      .join(' / ')}`,
  ];

  if (plan.heat) {
    lines.push(
      `- 当日の暑さ: ${plan.heat.headline}`,
      `  この気温なら ${plan.heat.adjustedTime}（${plan.heat.adjustedPace}）が、同じきつさになる見込み。`,
      '- **本人の目標は書き換えないこと。** 下げるかどうかを決めるのは本人。',
      '  出すのは「この気温なら、これくらいが同じきつさ」という見込みまで。',
    );
  }

  lines.push(
    '- **「前半を抑えて」だけで終わらせないこと。** 抑えるのは誰でも分かっている。',
    '  分からないのは何分何秒で入るかなので、聞かれたら上の数字で答える。',
    '- 崩れた時の決めごとも画面にある。**当日になってから考えさせない。**',
  );
  return lines.join('\n');
}
