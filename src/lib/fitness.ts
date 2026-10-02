/**
 * いまの力で、目標に届くのか。
 *
 * **走る人が本当に知りたいのは、これひとつ。**
 * 練習を積んでいても、「で、サブ3.5に届くの？」には誰も答えてくれない。
 * 時計は予測タイムを出すが、**なぜその数字なのか**も、**何をすれば縮まるのか**も言わない。
 *
 * ## 何から読むか（上が強い）
 *
 *  1. **大会の記録。** 本気で出し切った記録だけが、本当の力を示す
 *  2. **ポイント練習**（閾値走・インターバル・タイムトライアル）
 *  3. それも無ければ、**答えない。** イージーのジョグから力は測れない
 *
 * ## やらないこと
 *
 * - **「無理です」と言わない。** 言うのは、いまの差と、何をすれば縮まるか。
 * - **練習から出した数字を、レースの予測として断定しない。**
 *   練習は本気の出し切りではないので、出てくるのは「少なくともこのくらい」の下限。
 * - **届いている人を、褒めて終わらない。** 届く力があることと、当日出せることは別。
 */

import type { ActivityLog, RunnerProfile } from './types';
import { MARATHON_KM, estimateVdot, formatDuration, parseDuration } from './goals';
import { raceDistanceKm } from './gear-spec';
import { coachDate } from './day';
import { targetRace } from './races';

/** さかのぼる週数。これより古い記録は、いまの力ではない。 */
const LOOK_BACK_DAYS = 56;
/** 力を測るのに短すぎる距離。流しや細切れの記録が混ざる。 */
const MIN_KM = 3;

const DAY_MS = 86_400_000;

/** ポイント練習らしい名前。ここに当たるものだけ、力の材料に使う。 */
const HARD_WORDS = /閾値|インターバル|ペース走|テンポ|レース|TT|タイムトライアル|記録会|ビルドアップ/;

export type FitnessSource = 'race' | 'hard' | 'none';

export interface FitnessRead {
  source: FitnessSource;
  /** 材料にした記録。 */
  from?: { date: string; label: string; km: number; time: string };
  /** 目標の距離での予測タイム。 */
  predicted?: string;
  /** 目標タイム。 */
  target?: string;
  /** 目標との差（秒）。マイナスなら、いまの力で届いている。 */
  gapSec?: number;
  verdict: 'reachable' | 'close' | 'stretch' | 'far' | 'unknown';
  headline: string;
  detail: string;
  /** 何をすれば縮まるか。 */
  next: string[];
}

/**
 * 人が読む時間の書き方。
 *
 * **「0:01:44」は、差として読めない。** 1時間に満たないものに時間の桁を付けない。
 */
export function shortTime(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  if (h > 0) return m > 0 ? `${h}時間${m}分` : `${h}時間`;
  if (m > 0) return s > 0 ? `${m}分${s}秒` : `${m}分`;
  return `${s}秒`;
}

function daysAgo(date: string, now: Date): number | undefined {
  const at = Date.parse(`${(date ?? '').slice(0, 10)}T00:00:00Z`);
  const today = Date.parse(`${coachDate(now)}T00:00:00Z`);
  if (Number.isNaN(at) || Number.isNaN(today)) return undefined;
  return (today - at) / DAY_MS;
}

function secondsOf(activity: ActivityLog): number | undefined {
  const minutes = activity.durationMin;
  return minutes && minutes > 0 ? minutes * 60 : undefined;
}

/**
 * VDOT から、その距離のタイムを出す。
 *
 * 逆算は閉じた式にならないので、**秒を動かして合うところを探す**。
 * 1秒刻みで2万回まで試せば、どの市民ランナーの範囲も収まる。
 */
export function timeForVdot(distanceKm: number, vdot: number): number | undefined {
  if (!(distanceKm > 0) || !(vdot > 0)) return undefined;
  const meters = distanceKm * 1000;

  let low = 60;
  let high = 60 * 60 * 12;
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    const value = estimateVdot(meters, mid);
    if (value === undefined) return undefined;
    // 遅いほど VDOT は下がる。目標の VDOT より高ければ、もっと遅くしてよい。
    if (value > vdot) low = mid;
    else high = mid;
  }
  return Math.round((low + high) / 2);
}

interface Candidate {
  activity: ActivityLog;
  vdot: number;
  source: FitnessSource;
}

/** 力の材料になる記録を集める。**イージーのジョグは入れない。** */
function candidates(profile: RunnerProfile, now: Date): Candidate[] {
  const found: Candidate[] = [];

  for (const activity of profile.activities ?? []) {
    if (activity.type !== 'run') continue;
    const ago = daysAgo(activity.date, now);
    if (ago === undefined || ago < 0 || ago > LOOK_BACK_DAYS) continue;

    const km = activity.distanceKm;
    const seconds = secondsOf(activity);
    if (!km || km < MIN_KM || !seconds) continue;

    const name = activity.session ?? '';
    const isRace = /レース|記録会|マラソン|大会/.test(name);
    const isHard = HARD_WORDS.test(name);
    if (!isRace && !isHard) continue;

    const vdot = estimateVdot(km * 1000, seconds);
    if (vdot === undefined || vdot <= 0) continue;
    found.push({ activity, vdot, source: isRace ? 'race' : 'hard' });
  }

  return found;
}

/**
 * いまの力の読み。
 *
 * **材料が無ければ、答えない。** 推測で数字を出すほうが、黙っているより害が大きい。
 */
export function readFitness(profile: RunnerProfile, now: Date = new Date()): FitnessRead {
  const race = targetRace(profile, now);
  const targetSeconds =
    parseDuration(race?.targetTime) ?? parseDuration(profile.goal?.targetTime);
  const distanceKm = raceDistanceKm(race) ?? (targetSeconds !== undefined ? MARATHON_KM : undefined);

  const found = candidates(profile, now);
  if (found.length === 0) {
    return {
      source: 'none',
      verdict: 'unknown',
      headline: 'いまの力は、まだ測れていません',
      detail:
        'イージーのジョグからは、力は測れません。本気で出し切った記録——大会、記録会、' +
        '閾値走やインターバルのような練習——が1本あれば、そこから見込みを出せます。',
      next: [
        '次のポイント練習に「閾値走」「インターバル」のように名前を付けて記録する',
        '過去の大会の記録があれば、カルテに入れる',
      ],
    };
  }

  // **いちばん強い材料を使う。** 大会があれば大会、無ければ最も良いポイント練習。
  const best = found
    .slice()
    .sort((a, b) => (a.source === b.source ? b.vdot - a.vdot : a.source === 'race' ? -1 : 1))[0];

  const bestKm = best.activity.distanceKm ?? 0;
  const bestSeconds = secondsOf(best.activity) ?? 0;
  const from = {
    date: best.activity.date,
    label: best.activity.session ?? (best.source === 'race' ? 'レース' : 'ポイント練習'),
    km: Math.round(bestKm * 10) / 10,
    time: shortTime(bestSeconds),
  };

  if (targetSeconds === undefined || !distanceKm) {
    return {
      source: best.source,
      from,
      verdict: 'unknown',
      headline: '目標を決めると、届くかどうかが出せます',
      detail:
        `${from.date}の${from.label}（${from.km}km / ${from.time}）から、いまの力は読めています。` +
        '目標タイムを決めれば、そこまでの差と、何をすれば縮まるかを出します。',
      next: ['カルテで目標タイムを決める'],
    };
  }

  const predictedSeconds = timeForVdot(distanceKm, best.vdot);
  if (predictedSeconds === undefined) {
    return {
      source: 'none',
      from,
      verdict: 'unknown',
      headline: 'いまの力は、まだ測れていません',
      detail: '記録から見込みを計算できませんでした。',
      next: [],
    };
  }

  const gapSec = Math.round(predictedSeconds - targetSeconds);
  const ratio = gapSec / targetSeconds;
  const verdict: FitnessRead['verdict'] =
    gapSec <= 0 ? 'reachable' : ratio <= 0.03 ? 'close' : ratio <= 0.08 ? 'stretch' : 'far';

  const gapText = shortTime(Math.abs(gapSec));
  const sourceNote =
    best.source === 'race'
      ? `${from.date}の${from.label}（${from.km}km / ${from.time}）から出しています。`
      : `${from.date}の${from.label}（${from.km}km / ${from.time}）から出しています。` +
        '練習は本気の出し切りではないので、これは「少なくともこのくらい」の下限です。';

  if (verdict === 'reachable') {
    return {
      source: best.source,
      from,
      predicted: formatDuration(predictedSeconds),
      target: formatDuration(targetSeconds),
      gapSec,
      verdict,
      headline: `いまの力で、目標より ${gapText} 速い見込みです`,
      detail:
        `${sourceNote}届く力はあります。ただし、当日に出せるかは別の話です。` +
        '本番で崩れるのは、力が足りない時より、入りが速すぎた時のほうが多い。',
      next: [
        '目標ペースで走る練習を、月に1〜2回入れる（感覚を体に入れる）',
        '当日の入りを、目標より1kmあたり8秒遅く守る',
        '目標を1段上げるかどうか、相談してもよい時期です',
      ],
    };
  }

  const months = Math.max(1, Math.round(Math.abs(ratio) * 100 / 2));
  const common = [
    '週の8割をイージーに保つ（ここが速すぎるのが、いちばん多い失敗）',
    '閾値走を週1回、20〜30分。いちばん効率よく縮む場所',
    'ロング走で、後半にペースを落とさずに終える',
  ];

  if (verdict === 'close') {
    return {
      source: best.source,
      from,
      predicted: formatDuration(predictedSeconds),
      target: formatDuration(targetSeconds),
      gapSec,
      verdict,
      headline: `あと ${gapText}。手が届くところにいます`,
      detail: `${sourceNote}いまの力での見込みは ${formatDuration(predictedSeconds)}。この差なら、積み方を変えずに詰まります。`,
      next: common,
    };
  }

  if (verdict === 'stretch') {
    return {
      source: best.source,
      from,
      predicted: formatDuration(predictedSeconds),
      target: formatDuration(targetSeconds),
      gapSec,
      verdict,
      headline: `あと ${gapText}。時間をかければ届きます`,
      detail:
        `${sourceNote}いまの力での見込みは ${formatDuration(predictedSeconds)}。` +
        `この差は、${months}か月ほどかけて詰める幅です。1か月で縮めようとすると、たいてい壊れます。`,
      next: common,
    };
  }

  return {
    source: best.source,
    from,
    predicted: formatDuration(predictedSeconds),
    target: formatDuration(targetSeconds),
    gapSec,
    verdict,
    headline: `あと ${gapText}。いまは差があります`,
    detail:
      `${sourceNote}いまの力での見込みは ${formatDuration(predictedSeconds)}。` +
      '届かない、という意味ではありません。必要なのは時間で、' +
      `この幅はふつう${months}か月以上かかります。途中の目標を置くほうが、結局は速く着きます。`,
    next: [
      '手前に1つ、届く目標を置く（ハーフや、少し緩めのタイム）',
      ...common,
    ],
  };
}

/**
 * プロンプトに差し込む、いまの力。
 *
 * **ここは、いちばん嘘をつきやすい場所。** 聞かれて気の利いたことを言おうとすると、
 * 根拠のない「いけます」が出る。数字と、その出どころを固定しておく。
 */
export function fitnessDoctrine(profile: RunnerProfile, now: Date = new Date()): string | null {
  const read = readFitness(profile, now);
  if (read.verdict === 'unknown' && read.source === 'none') {
    return [
      '# いまの力（まだ測れていない）',
      '- 本気で出し切った記録（大会・記録会・閾値走・インターバル）が、直近8週に無い。',
      '- **イージーのジョグから力を推測して答えないこと。** 聞かれたら、測るための1本を勧める。',
    ].join('\n');
  }

  const lines = [
    '# 画面に出ている「目標に届くか」（**この数値は計算済み。自分で計算し直さないこと**）',
    `- 判定: ${read.headline}`,
  ];
  if (read.from) {
    lines.push(`- 材料: ${read.from.date} ${read.from.label}（${read.from.km}km / ${read.from.time}）`);
  }
  if (read.predicted && read.target) {
    lines.push(`- いまの力での見込み: ${read.predicted} / 目標: ${read.target}`);
  }
  if (read.source === 'hard') {
    lines.push(
      '- **これは練習から出した下限。** 本気の出し切りではないので、実際はもう少し速い可能性がある。',
      '  「この記録では無理」と断定しないこと。',
    );
  }
  lines.push(
    '- **「無理です」と言わないこと。** 言うのは、いまの差と、何をすれば縮まるか。',
    '- 届いている人にも、**当日出せるかは別**だと伝えること。',
    '  本番で崩れるのは、力が足りない時より入りが速すぎた時のほうが多い。',
  );
  return lines.join('\n');
}
