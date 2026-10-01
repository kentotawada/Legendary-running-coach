/**
 * 1日に使った量と、食べた量。
 *
 * **これは「減らす」ための道具ではない。「足りているか」を見るための道具。**
 *
 * 走る人にとって、食べすぎより食べなさすぎのほうがずっと危ない。
 * 足りない状態が続くと、疲労骨折・貧血・月経の異常・免疫の低下に
 * つながる（相対的エネルギー不足）。体重が減っているのに記録が伸びない、
 * いつも疲れている、というのは、たいていここが原因。
 *
 * だからこの層は、**不足だけを見張る。** 食べすぎは数えない、警告しない。
 * 目標の数値も出さない（prompt.ts の絶対原則6）。
 *
 * 1日の消費は、運動よりも基礎代謝のほうがずっと大きい。
 * 10km走って約600kcal、基礎代謝は1,400kcal前後。
 * **だから基礎代謝の精度が、結果のほとんどを決める。**
 */

import { estimateCalories } from './calories';
import { isBodyFatInRange, isHeightInRange, leanMassKg } from './composition';
import type { RunnerProfile } from './types';

/**
 * 運動以外の生活でつかう分の係数。
 *
 * 基礎代謝 × 1.2 が「ほとんど座っている人の、運動を除いた1日」。
 * 走った分はこれとは別に足す。**デスクワークを前提に、低いほうを採る。**
 * 高く見積もると、足りていない人を「足りている」と言ってしまう。
 */
export const LIVING_FACTOR = 1.2;

export type BmrMethod = 'katch' | 'mifflin';

export interface Basal {
  kcal: number;
  method: BmrMethod;
  /** 何が分かればもっと良くなるか。すでに最良なら null。 */
  improve: string | null;
}

/**
 * 基礎代謝。
 *
 * **体脂肪率があれば、そちらを使う（Katch-McArdle）。**
 * 除脂肪体重から出すので、走る人のように筋肉の割合が高い体には、
 * 体重だけの式よりずっと近い。身長も年齢も性別も要らない。
 *
 * 無ければ Mifflin-St Jeor。こちらは身長・年齢・性別がそろって初めて出せる。
 */
export function basalMetabolicRate(profile: RunnerProfile | null | undefined): Basal | null {
  const weightKg = profile?.bodyWeightKg;
  if (!weightKg || weightKg <= 0) return null;

  const fat = profile?.bodyFatPercent;
  if (isBodyFatInRange(fat)) {
    const lean = leanMassKg(weightKg, fat);
    return { kcal: Math.round(370 + 21.6 * lean), method: 'katch', improve: null };
  }

  const heightCm = profile?.heightCm;
  const age = profile?.age;
  const sex = profile?.sex;
  if (!isHeightInRange(heightCm) || !age || age < 10 || age > 100 || !sex) return null;

  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return {
    kcal: Math.round(sex === 'male' ? base + 5 : base - 161),
    method: 'mifflin',
    improve: '体組成計の体脂肪率が分かると、走る人にはもっと近い数字になります',
  };
}

/** 何が足りなくて出せないのか。**「—」だけを出さない。** */
export function whyNoBasal(profile: RunnerProfile | null | undefined): string | null {
  if (!profile?.bodyWeightKg) return '体重を記録すると、1日に使う量を出せます';
  if (isBodyFatInRange(profile.bodyFatPercent)) return null;
  const missing: string[] = [];
  if (!isHeightInRange(profile.heightCm)) missing.push('身長');
  if (!profile.age) missing.push('年齢');
  if (!profile.sex) missing.push('性別');
  if (missing.length === 0) return null;
  return `体脂肪率、または ${missing.join('・')} が分かると、1日に使う量を出せます`;
}

export interface DayEnergy {
  date: string;
  /** 基礎代謝(kcal)。 */
  basal: number | null;
  /** 運動以外の生活でつかった分(kcal)。 */
  living: number | null;
  /** 運動でつかった分(kcal)。 */
  exercise: number;
  /** 合計の消費(kcal)。基礎代謝が出せなければ null。 */
  burned: number | null;
  /** 食べた量の目安(kcal)。記録が無ければ null。 */
  intake: number | null;
  /** 摂取 − 消費。両方そろった時だけ。負なら足りていない。 */
  balance: number | null;
}

/** その日の、使った量と食べた量。 */
export function dayEnergy(
  profile: RunnerProfile | null | undefined,
  date: string,
): DayEnergy {
  const basalInfo = basalMetabolicRate(profile);
  const basal = basalInfo?.kcal ?? null;
  const living = basal === null ? null : Math.round(basal * (LIVING_FACTOR - 1));

  const exercise = (profile?.activities ?? [])
    .filter((activity) => (activity.date ?? '').slice(0, 10) === date)
    .map((activity) => estimateCalories(activity, profile?.bodyWeightKg))
    .filter((value): value is number => value !== null)
    .reduce((sum, value) => sum + value, 0);

  const record = (profile?.dailyLog ?? []).find((entry) => entry.date === date);
  const intake =
    record?.intakeKcal !== undefined && record.intakeKcal > 0 ? Math.round(record.intakeKcal) : null;

  const burned = basal === null || living === null ? null : basal + living + exercise;

  return {
    date,
    basal,
    living,
    exercise,
    burned,
    intake,
    balance: burned !== null && intake !== null ? intake - burned : null,
  };
}

/**
 * 足りているか。
 *
 * **足りすぎは見ない。** 食べすぎを数えると、この画面は減量の道具になる。
 * 走る人にとって危ないのは、その逆のほうなので、不足だけを見張る。
 */
export type FuelLevel =
  /** 足りている。 */
  | 'ok'
  /** 不足が続いている。 */
  | 'watch'
  /** 基礎代謝を下回っている。**ここは、はっきり言う。** */
  | 'low';

export interface FuelCheck {
  /** 食べた量の記録があった日数。 */
  loggedDays: number;
  averageIntake: number;
  averageBurn: number;
  averageBasal: number;
  /** 1日あたりの平均の不足(kcal)。正なら足りていない。 */
  shortfall: number;
  level: FuelLevel;
}

/** これを超える不足が続いていたら、様子を見る。 */
export const WATCH_SHORTFALL = 500;
/** 記録がこれだけ無いと、見立てを出さない。 */
export const MIN_LOGGED_DAYS = 3;

export function fuelCheck(
  profile: RunnerProfile | null | undefined,
  options: { days?: number; now?: Date } = {},
): FuelCheck | null {
  const { days = 14, now = new Date() } = options;
  const basal = basalMetabolicRate(profile);
  if (!basal) return null;

  const from = now.getTime() - days * 86_400_000;
  const logged = (profile?.dailyLog ?? []).filter(
    (record) =>
      record.intakeKcal !== undefined &&
      record.intakeKcal > 0 &&
      Date.parse(`${record.date}T12:00:00`) >= from,
  );
  if (logged.length < MIN_LOGGED_DAYS) return null;

  const each = logged.map((record) => dayEnergy(profile, record.date));
  const mean = (pick: (day: DayEnergy) => number) =>
    each.reduce((sum, day) => sum + pick(day), 0) / each.length;

  const averageIntake = Math.round(mean((day) => day.intake ?? 0));
  const averageBurn = Math.round(mean((day) => day.burned ?? 0));
  const shortfall = averageBurn - averageIntake;

  return {
    loggedDays: logged.length,
    averageIntake,
    averageBurn,
    averageBasal: basal.kcal,
    shortfall,
    // 基礎代謝を下回る食べ方は、何日も続けてよいものではない。
    level: averageIntake < basal.kcal ? 'low' : shortfall > WATCH_SHORTFALL ? 'watch' : 'ok',
  };
}

/**
 * 見立てへの一言。
 *
 * **目標の数値を出さない。**「あと◯kcal食べましょう」も言わない。
 * 言うのは、足りているかどうかと、次にどうするか。
 */
export function describeFuel(check: FuelCheck): { title: string; detail: string } {
  switch (check.level) {
    case 'low':
      return {
        title: '食べる量が足りていません',
        detail:
          `直近${check.loggedDays}日の平均で、食べた量（${check.averageIntake.toLocaleString('ja-JP')}kcal）が` +
          `基礎代謝（${check.averageBasal.toLocaleString('ja-JP')}kcal）を下回っています。` +
          '基礎代謝は、1日じっと寝ていても使う量です。これを下回る日が続くと、' +
          '疲労骨折・貧血・免疫の低下につながります。走る量ではなく、食べる量のほうを見直してください。',
      };
    case 'watch':
      return {
        title: '少し足りていないかもしれません',
        detail:
          `直近${check.loggedDays}日の平均で、1日あたり ${check.shortfall.toLocaleString('ja-JP')}kcal ほど足りていません。` +
          '走った日は、いつもより食べて大丈夫です。練習の質が落ちていたり、いつも疲れているなら、まずここを疑ってください。',
      };
    case 'ok':
      return {
        title: '足りています',
        detail: `直近${check.loggedDays}日の平均で、使った量と食べた量が釣り合っています。この調子で。`,
      };
  }
}

/** 画面に必ず添える但し書き。 */
export const ENERGY_NOTE =
  '食べた量は、話してもらった内容からの目安です。正確な数値ではありません。' +
  '足りているかを見るためのもので、減らすためのものではありません。';
