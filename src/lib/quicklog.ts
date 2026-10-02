/**
 * 走ったことを、数タップで入れる。
 *
 * **いまの作りでは、記録を手で入れる道が1本しかない。**
 * 「今日10km走りました」とチャットに打つ道で、これには2つ問題がある。
 *
 *  1. **1往復 ¥4.32 かかる。** 記録を入れるだけで、相談のぶんの予算が減る
 *  2. **スマホで日本語を打つのが、いちばん遅い入力**。走り終えた直後にやりたくない
 *
 * Strava をつないでいない人（Garmin Connect や Nike を直接使っている人）には、
 * これが毎日の道になる。**毎日いちばんよく使う操作が、いちばん重い**状態だった。
 *
 * ここでやるのは、距離と時間だけを受け取ること。モデルは呼ばない。
 *
 * ## 速くするための考え
 *
 * - **その人がいつも走る距離を、そのまま札にする。** 5km の人に 10km を見せない
 * - **時間は、その人の普段のペースから先に埋めておく。** ゼロから打たせない
 * - **手応えは聞かない。** 保存したあとに、もともと出る1行（FeltRow）が拾う
 */

import type { ActivityLog, RunnerProfile } from './types';
import { coachDate } from './day';
import { formatPace, marathonPaceSeconds } from './goals';

/** 札に出す距離の数。これより多いと、選ぶより打つほうが速くなる。 */
export const MAX_CHOICES = 5;
/** 普段のペースを見るのに、どこまでさかのぼるか。 */
const PACE_FROM_DAYS = 60;
/** 似た距離と見なす幅。これを超えると、別の種類の練習のペースになる。 */
const NEAR_RATIO = 0.3;
/** ペースの下限と上限（秒/km）。これを外れる値は、読み違えか入力の誤り。 */
const MIN_PACE_SEC = 150;
const MAX_PACE_SEC = 900;

const DAY_MS = 86_400_000;

function dayIndex(date: string): number | undefined {
  const at = Date.parse(`${(date ?? '').slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(at) ? undefined : Math.round(at / DAY_MS);
}

/** その練習の1kmあたりの秒数。あり得ない値は返さない。 */
function paceSecOf(activity: ActivityLog): number | undefined {
  const km = activity.distanceKm;
  const min = activity.durationMin;
  if (!km || !min || km <= 0 || min <= 0) return undefined;
  const pace = (min * 60) / km;
  return pace >= MIN_PACE_SEC && pace <= MAX_PACE_SEC ? pace : undefined;
}

/** 直近の走りだけを、新しい順に。 */
function recentRuns(profile: RunnerProfile, now: Date): ActivityLog[] {
  const today = dayIndex(coachDate(now));
  if (today === undefined) return [];
  return (profile.activities ?? [])
    .filter((activity) => {
      if (activity.type !== 'run') return false;
      const at = dayIndex(activity.date);
      if (at === undefined) return false;
      const ago = today - at;
      return ago >= 0 && ago <= PACE_FROM_DAYS;
    })
    .reverse();
}

/**
 * 札に出す距離。
 *
 * **その人が実際に走っている距離を出す。** 5km しか走らない人に
 * 「10 / 15 / 20」を見せても、どれも押されない。
 * 今日の予定を先頭に置くのは、たいていその通りに走るため。
 */
export function distanceChoices(
  profile: RunnerProfile | null | undefined,
  plannedKm?: number,
  now: Date = new Date(),
): number[] {
  const out: number[] = [];
  const push = (km: number) => {
    const rounded = Math.round(km * 10) / 10;
    if (rounded <= 0 || rounded > 100) return;
    // 0.5km 以内のものは、同じ札として扱う。並べても選び分けられない。
    if (out.some((item) => Math.abs(item - rounded) < 0.5)) return;
    out.push(rounded);
  };

  // 今日の予定。たいていこの通りに走るので、先頭に置く。
  if (plannedKm && plannedKm > 0) push(plannedKm);

  /*
    **よく走る距離を、多い順に。**
    1km 刻みに丸めて数える。10.2km と 9.8km は、札としては同じ「10km」。
  */
  const counts = new Map<number, number>();
  for (const activity of profile ? recentRuns(profile, now) : []) {
    const km = activity.distanceKm;
    if (!km || km <= 0) continue;
    const bucket = Math.max(1, Math.round(km));
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  for (const [km] of [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])) {
    if (out.length >= MAX_CHOICES) break;
    push(km);
  }

  // 1本も記録が無い人には、短いところから。**初日に20kmを見せない。**
  if (out.length === 0) return [3, 5, 8, 10];

  return out.slice(0, MAX_CHOICES).sort((a, b) => a - b);
}

/**
 * その距離を、普段どれくらいの時間で走っているか（秒）。
 *
 * **ゼロから打たせないために。** 似た距離の直近のペースを使い、
 * 無ければ全体のペース、それも無ければ目標ペースから置く。
 * 当たっていなくてよい。**打つ代わりに、押して直せる状態をつくる**ためのもの。
 */
export function guessSeconds(
  profile: RunnerProfile | null | undefined,
  km: number,
  now: Date = new Date(),
): number | undefined {
  if (!profile || km <= 0) return undefined;
  const pace = guessPaceSec(profile, km, now);
  return pace ? Math.round(pace * km) : undefined;
}

/** その距離あたりの、普段の1kmのペース（秒）。 */
export function guessPaceSec(
  profile: RunnerProfile | null | undefined,
  km: number,
  now: Date = new Date(),
): number | undefined {
  if (!profile) return undefined;
  const runs = recentRuns(profile, now);

  /*
    **似た距離のペースを先に使う。**
    5km のペースで 30km の時間を見積もると、1本まるごとずれる。
  */
  const near = runs
    .filter((activity) => {
      const distance = activity.distanceKm;
      if (!distance || distance <= 0) return false;
      return Math.abs(distance - km) / km <= NEAR_RATIO;
    })
    .map(paceSecOf)
    .filter((value): value is number => value !== undefined)
    .slice(0, 5);

  if (near.length > 0) return Math.round(near.reduce((a, b) => a + b, 0) / near.length);

  const all = runs
    .map(paceSecOf)
    .filter((value): value is number => value !== undefined)
    .slice(0, 10);
  if (all.length > 0) {
    const mean = all.reduce((a, b) => a + b, 0) / all.length;
    /*
      全体のペースしか無い時は、距離で少し調整する。
      長い距離は遅く、短い距離は速くなる。**倍率は控えめに。**
      外した見積もりを押し付けるより、少しずれた数字を直してもらうほうがいい。
    */
    const reference = median(runs);
    const ratio = reference > 0 ? km / reference : 1;
    const adjust = ratio > 1.5 ? 1.06 : ratio < 0.6 ? 0.96 : 1;
    return Math.round(mean * adjust);
  }

  // 記録が無い人。目標から置く。**無ければ何も出さない。**
  const goalPace = marathonPaceSeconds(profile.goal?.targetTime);
  return goalPace ? Math.round(goalPace * 1.15) : undefined;
}

/** よく走る距離の中央値。全体ペースを距離で調整するための基準。 */
function median(runs: ActivityLog[]): number {
  const list = runs
    .map((activity) => activity.distanceKm)
    .filter((km): km is number => typeof km === 'number' && km > 0)
    .sort((a, b) => a - b);
  if (list.length === 0) return 0;
  return list[Math.floor(list.length / 2)];
}

/** 「52:30」。1時間を超えたら「1:52:30」。 */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** 入れた数字から出る、1kmあたりのペース。距離か時間が無ければ出さない。 */
export function paceOf(km: number, seconds: number): string | undefined {
  if (km <= 0 || seconds <= 0) return undefined;
  const pace = seconds / km;
  if (pace < MIN_PACE_SEC || pace > MAX_PACE_SEC) return undefined;
  return formatPace(pace);
}

/** 日付の札。昨日ぶんを後から入れる人は多い。 */
export interface DayChoice {
  /** 何日前か。0 は今日。 */
  ago: number;
  label: string;
  date: string;
}

export function dayChoices(now: Date = new Date()): DayChoice[] {
  const labels = ['今日', '昨日', 'おととい'];
  const base = Date.parse(`${coachDate(now)}T00:00:00Z`);
  return labels.map((label, ago) => ({
    ago,
    label,
    date: new Date(base - ago * DAY_MS).toISOString().slice(0, 10),
  }));
}

/** 練習の種類。**選ばなくても保存できる。** */
export const SESSION_KINDS = [
  { id: 'jog', label: 'ジョグ', session: 'ジョグ' },
  { id: 'point', label: 'ポイント', session: 'ポイント練習' },
  { id: 'long', label: 'ロング', session: 'ロング走' },
  { id: 'walk', label: 'ウォーク', session: 'ウォーク' },
] as const;

export type SessionKindId = (typeof SESSION_KINDS)[number]['id'];

/**
 * 送る形に組み立てる。
 *
 * **時刻は、その日の正午に置く。**
 * 走った時刻までは聞かない（聞いても押す手間が増えるだけ）。
 * 日付の境目から離しておけば、取り込み側がどの日に入れるかで迷わない。
 */
export function toWorkout(input: {
  date: string;
  km: number;
  seconds?: number;
  kind?: SessionKindId;
  now?: Date;
}): {
  externalId: string;
  startedAt: string;
  type: 'run' | 'walk';
  distanceM: number;
  durationSec?: number;
  name?: string;
  source: 'self-report';
} | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return null;
  if (!(input.km > 0)) return null;

  const kind = SESSION_KINDS.find((item) => item.id === input.kind);
  const stamp = (input.now ?? new Date()).getTime();

  return {
    /*
      **同じ日に2本入れられるようにする。** 朝と夕の2部練習は普通にある。
      日付だけを ID にすると、2本目が1本目を上書きしてしまう。
    */
    externalId: `self:${input.date}:${Math.round(input.km * 100)}:${stamp}`,
    startedAt: `${input.date}T12:00:00`,
    type: input.kind === 'walk' ? 'walk' : 'run',
    distanceM: Math.round(input.km * 1000),
    durationSec: input.seconds && input.seconds > 0 ? Math.round(input.seconds) : undefined,
    name: kind?.session,
    source: 'self-report',
  };
}
