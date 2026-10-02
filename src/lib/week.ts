/**
 * この先7日の並び。
 *
 * **今日だけでは、計画の置き場所にならない。**
 * 「今週どうなるのか」が見えないと、結局それを置いている道具（時計のアプリや手帳）が
 * 本体になり、こちらは相談しに来るだけの場所に戻ってしまう。
 *
 * ## 組み立て方
 *
 *  - **土台は、本人がいま実際に走っている量。** 目標の表から引いた理想値を置くと、
 *    初週から2倍の計画が出て、見た瞬間に閉じられる。
 *  - 週の8割はイージー、ポイントは週1〜2回。ロングは週の3割まで。
 *  - 痛みがある間は、全部休み。**ここは何があっても動かさない。**
 *  - 大会が入っていれば、その日を中心に前後を組み替える。
 *
 * ## やらないこと
 *
 * **先の日に確定的な数字を置かない。** 4日先の体調は誰にも分からない。
 * 出すのは「その日に置くつもりの種類と、だいたいの距離」まで。
 */

import type { RunnerProfile } from './types';
import { assessSafety } from './safety';
import { coachDate } from './day';
import { daysUntil, targetRace } from './races';
import { workloadOf } from './workload';
import { todayPlan } from './today';

export type WeekKind = 'rest' | 'easy' | 'point' | 'long' | 'race';

export interface WeekDay {
  /** YYYY-MM-DD */
  date: string;
  /** 月・火・… */
  weekday: string;
  isToday: boolean;
  kind: WeekKind;
  label: string;
  /** 置くつもりの距離。休みの日は undefined。 */
  km?: number;
  /** その日にだけ添える一言。 */
  note?: string;
  /**
   * コーチと話して決めた日か。
   *
   * **自動で置いた日と、決めた日は、別物として扱う。**
   * 決めた日を黙って組み替えると、「動かしておきました」と言われたものが
   * 翌朝には元に戻っていることになる。
   */
  fromPlan?: boolean;
}

export interface WeekPlan {
  days: WeekDay[];
  /** 7日の合計（置くつもりの距離）。 */
  totalKm: number;
  /** 土台にした、1週あたりの実績。 */
  baseKm: number;
  /** 画面に出す、組み立ての理由。 */
  note: string;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const DAY_MS = 86_400_000;

const LABEL: Record<WeekKind, string> = {
  rest: '休み',
  easy: 'イージー',
  point: 'ポイント',
  long: 'ロング',
  race: '大会',
};

function dayIndex(date: string): number {
  return Math.round(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / DAY_MS);
}

function dateOf(index: number): string {
  return new Date(index * DAY_MS).toISOString().slice(0, 10);
}

/** 直近4週の、1週あたりの走行距離。**本人がいま走っている量を土台にする。** */
function baseWeeklyKm(profile: RunnerProfile, now: Date): number {
  const workload = workloadOf(profile, now);
  if (workload && workload.chronicKm > 0) return workload.chronicKm;

  // 記録が浅い人。直近2週の実績から、そのまま置く。
  const today = dayIndex(coachDate(now));
  const km = (profile.activities ?? [])
    .filter((activity) => {
      if (activity.type !== 'run') return false;
      const ago = today - dayIndex(activity.date);
      return ago >= 0 && ago < 14;
    })
    .reduce((sum, activity) => sum + (activity.distanceKm ?? 0), 0);
  return Math.round((km / 2) * 10) / 10;
}

/** 走った日が分かるように、すでにある記録を日付で引けるようにする。 */
function ranOn(profile: RunnerProfile): Set<string> {
  return new Set(
    (profile.activities ?? [])
      .filter((activity) => activity.type === 'run' && (activity.distanceKm ?? 0) > 0)
      .map((activity) => activity.date.slice(0, 10)),
  );
}

/**
 * 1週間の形。
 *
 * **曜日で決め打ちしない。** 平日が休みの人も、週末に走れない人もいる。
 * 決めるのは並びだけ（ポイントの間は中2日、ロングは週末寄り）。
 */
function shapeFor(pointsPerWeek: number): WeekKind[] {
  if (pointsPerWeek >= 2) {
    // 月:イージー 火:ポイント 水:イージー 木:休み 金:ポイント 土:イージー 日:ロング
    return ['easy', 'point', 'easy', 'rest', 'point', 'easy', 'long'];
  }
  if (pointsPerWeek === 1) {
    return ['easy', 'point', 'easy', 'rest', 'easy', 'easy', 'long'];
  }
  return ['easy', 'easy', 'rest', 'easy', 'easy', 'rest', 'long'];
}

/** 目標から、週に置くポイント練習の回数を決める。 */
function pointsPerWeek(profile: RunnerProfile, base: number): number {
  const goal = profile.goal;
  if (!goal || goal.kind === 'health' || goal.kind === 'habit') return 0;
  // 土台が薄いうちにポイントを2回置くと、そこで壊れる。
  if (base < 25) return 1;
  return base >= 50 ? 2 : 1;
}

export function weekPlan(profile: RunnerProfile, now: Date = new Date()): WeekPlan {
  const todayDate = coachDate(now);
  const today = dayIndex(todayDate);
  const ran = ranOn(profile);

  const makeDay = (offset: number, kind: WeekKind, km?: number, note?: string): WeekDay => {
    const date = dateOf(today + offset);
    return {
      date,
      weekday: WEEKDAYS[new Date(date).getUTCDay()],
      isToday: offset === 0,
      kind,
      label: LABEL[kind],
      km,
      note,
    };
  };

  // 痛みがあるあいだは、全部休み。**ここは動かさない。**
  const safety = assessSafety(profile, now);
  if (safety.runningForbidden) {
    const sites = safety.activePains.map((pain) => pain.site).join('・');
    return {
      days: Array.from({ length: 7 }, (_, offset) =>
        makeDay(offset, 'rest', undefined, offset === 0 ? '歩く・ストレッチ' : undefined),
      ),
      totalKm: 0,
      baseKm: 0,
      note: `${sites || '痛み'}が引くまでは、走る予定を置きません。引いてから組み直します。`,
    };
  }

  const base = baseWeeklyKm(profile, now);
  const workload = workloadOf(profile, now);

  /*
    **増やさない。** 7日ぶんの合計は、いま走っている量（直近4週の平均）と同じにする。
    ここで1割でも積むと、計画の上では毎週1割ずつ増えていく。
    増やすのは、同じ量を続けられていることを本人と確かめてから。
  */
  const weekKm = base;

  const points = pointsPerWeek(profile, base);
  const shape = shapeFor(points);

  // 今日が週のどこに当たるかで、形をずらす。ロングが週末に来るように合わせる。
  const weekdayToday = new Date(todayDate).getUTCDay(); // 0=日
  const offsetInShape = (weekdayToday + 6) % 7; // 月曜=0

  const days: WeekDay[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    days.push(makeDay(offset, shape[(offsetInShape + offset) % 7]));
  }

  /*
    **今日の枠は、帯に出ているものと必ず同じにする。**
    帯が「脚を戻す日」で、並びの今日が「ポイント」だと、画面の中で
    コーチが二人いることになる。今日の決め方（today.ts）が唯一の正。
  */
  const todays = todayPlan(profile, now);
  days[0].kind = !todays.running
    ? 'rest'
    : todays.intensity === 'easy'
      ? 'easy'
      : todays.intensity === 'rest'
        ? 'rest'
        : 'point';
  days[0].label = LABEL[days[0].kind];

  /*
    **コーチと話して決めた日を、先に置く。**
    ここを見ないと、会話で「日曜は休みにしましょう」と決めた翌朝、
    画面には元のロングが並んでいることになる。コーチが二人いるのと同じ。
  */
  const planned = new Map((profile.plans ?? []).map((plan) => [plan.date, plan]));
  for (const day of days) {
    const plan = planned.get(day.date);
    if (!plan) continue;
    day.kind =
      plan.intensity === 'rest'
        ? 'rest'
        : plan.intensity === 'easy'
          ? 'easy'
          : /ロング|long|ＬＳＤ|LSD/i.test(plan.title)
            ? 'long'
            : 'point';
    day.label = LABEL[day.kind];
    day.note = plan.title;
    day.fromPlan = true;
  }

  // 大会が入っていれば、その日を中心に組み替える。
  const race = targetRace(profile, now);
  const left = race ? daysUntil(race.date, now) : undefined;
  if (race && left !== undefined && left >= 0 && left <= 6) {
    days[left] = makeDay(left, 'race', undefined, race.name);
    if (left - 1 >= 0) days[left - 1] = makeDay(left - 1, 'rest', undefined, '前日');
    if (left - 2 >= 0) days[left - 2] = makeDay(left - 2, 'easy', undefined, '短く + 流し');
    if (left + 1 <= 6) days[left + 1] = makeDay(left + 1, 'rest', undefined, '大会の翌日');
    if (left + 2 <= 6) days[left + 2] = makeDay(left + 2, 'rest', undefined, '戻す');
  }

  // すでに走った日（今日を含む）は、実績で上書きしない。予定の種類だけ残す。
  for (const day of days) {
    if (day.date === todayDate && ran.has(todayDate)) {
      day.kind = 'rest';
      day.label = '走った';
      day.note = '今日はもう走っています';
    }
  }

  // 距離を配る。ロングが週の3割、ポイントが2割弱、残りをイージーで割る。
  const runnable = days.filter((day) => day.kind === 'easy' || day.kind === 'point' || day.kind === 'long');
  const longDays = runnable.filter((day) => day.kind === 'long').length;
  const pointDays = runnable.filter((day) => day.kind === 'point').length;
  const easyDays = runnable.filter((day) => day.kind === 'easy').length;

  const longKm = longDays > 0 ? (weekKm * 0.3) / longDays : 0;
  const pointKm = pointDays > 0 ? (weekKm * 0.18) / pointDays : 0;
  const easyShare = weekKm - longKm * longDays - pointKm * pointDays;
  const easyKm = easyDays > 0 ? easyShare / easyDays : 0;

  for (const day of days) {
    if (day.kind === 'long') day.km = Math.round(longKm);
    else if (day.kind === 'point') day.km = Math.round(pointKm);
    else if (day.kind === 'easy') day.km = Math.round(easyKm);
    if (day.km !== undefined && day.km < 1) day.km = undefined;
  }

  /*
    **端数の積み上げで、土台を超えさせない。**
    1日ずつ四捨五入すると、5日ぶんで2〜3kmふくらむ。
    それは誰も決めていない増量で、毎週そのぶんずつ積み上がっていく。
    いちばん長い日で、合計を目標ちょうどに戻す。
  */
  const target = Math.round(weekKm);
  const sum = () => days.reduce((total, day) => total + (day.km ?? 0), 0);
  const longest = days
    .filter((day) => day.km !== undefined)
    .sort((a, b) => (b.km ?? 0) - (a.km ?? 0))[0];
  if (longest && target > 0) {
    const gap = target - sum();
    const next = (longest.km ?? 0) + gap;
    if (next >= 1) longest.km = next;
  }

  const totalKm = sum();

  const note =
    base <= 0
      ? '記録が貯まるほど、ここは本人の走り方に寄っていきます。いまは置き方の形だけ。'
      : workload?.level === 'high'
        ? `直近7日が急に増えています。この先7日は、いまの土台（週${base}km）と同じ量に戻します。`
        : `直近4週は1週あたり${base}km。この先7日も、同じ量で組んでいます。増やすのは、ここが続いてからです。`;

  return { days, totalKm, baseKm: base, note };
}

/**
 * プロンプトに差し込む、この先7日。
 * **画面に出ている並びと、コーチの言う週の組み立てを食い違わせない。**
 */
export function weekDoctrine(profile: RunnerProfile, now: Date = new Date()): string | null {
  const plan = weekPlan(profile, now);
  if (plan.baseKm <= 0) return null;

  const lines = [
    '# 画面に出ている「この先7日」（**本人はもう見ている**）',
    ...plan.days.map(
      (day) =>
        `- ${day.date}（${day.weekday}）${day.isToday ? '【今日】' : ''} ${day.label}` +
        `${day.km ? ` ${day.km}km` : ''}${day.note ? `（${day.note}）` : ''}` +
        `${day.fromPlan ? ' ★あなたが決めた日' : ''}`,
    ),
    `- 合計 ${plan.totalKm}km / 土台は1週あたり ${plan.baseKm}km`,
    '- **これは置き方の目安。** 相談されたら、その人の予定に合わせて動かしてよい。',
    '  ただし**週の合計は増やさない。** 動かすのは曜日と種類まで。',
    '- **動かしたら、必ず `set_today_plan` に date を付けて残すこと。**',
    '  残さないと、画面の並びは元のままになる。「動かしておきました」と言ったものが',
    '  翌朝には戻っている、がいちばん信用を失う。',
    '- ★の付いた日は、すでに話して決めた日。**勝手に組み替えないこと。**',
  ];
  return lines.join('\n');
}
