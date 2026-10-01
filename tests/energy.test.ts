import { describe, expect, it } from 'vitest';
import {
  ENERGY_NOTE,
  LIVING_FACTOR,
  WATCH_SHORTFALL,
  basalMetabolicRate,
  dayEnergy,
  describeFuel,
  fuelCheck,
  whyNoBasal,
} from '@/lib/energy';
import { createDefaultProfile } from '@/lib/types';
import type { ActivityLog, DailyRecord, RunnerProfile } from '@/lib/types';

/**
 * 使った量と、食べた量。
 *
 * **これは「減らす」ための道具ではない。「足りているか」を見るための道具。**
 * 走る人にとって、食べすぎより食べなさすぎのほうがずっと危ない。
 */

const NOW = new Date('2026-09-15T12:00:00+09:00');

function daysAgo(n: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const profileOf = (extra: Partial<RunnerProfile>): RunnerProfile => ({
  ...createDefaultProfile('t'),
  ...extra,
});

/** 体脂肪率あり（Katch-McArdle が使える人）。 */
const lean = profileOf({ bodyWeightKg: 60, bodyFatPercent: 15 });
/** 体脂肪率なし・身長と年齢と性別あり（Mifflin が使える人）。 */
const measured = profileOf({ bodyWeightKg: 60, heightCm: 170, age: 35, sex: 'male' });

describe('基礎代謝', () => {
  /**
   * 除脂肪体重から出す式のほうが、走る人には近い。
   * 身長も年齢も性別も要らないのが、この式の強み。
   */
  it('体脂肪率があれば、除脂肪体重から出す', () => {
    const basal = basalMetabolicRate(lean);
    expect(basal?.method).toBe('katch');
    // 除脂肪 51kg → 370 + 21.6 × 51 = 1471.6
    expect(basal?.kcal).toBe(1472);
    expect(basal?.improve).toBeNull();
  });

  it('体脂肪率が無ければ、身長・年齢・性別から出す', () => {
    const basal = basalMetabolicRate(measured);
    expect(basal?.method).toBe('mifflin');
    // 10×60 + 6.25×170 − 5×35 + 5 = 1492.5
    expect(basal?.kcal).toBe(1493);
    // こちらは、体脂肪率が入ればもっと良くなると伝える。
    expect(basal?.improve).toContain('体脂肪率');
  });

  it('身長が効いている（同じ体重でも背が高いほど多い）', () => {
    const tall = basalMetabolicRate(profileOf({ ...measured, heightCm: 185 }));
    const short = basalMetabolicRate(profileOf({ ...measured, heightCm: 155 }));
    expect(tall!.kcal).toBeGreaterThan(short!.kcal);
  });

  it('体脂肪率があれば、身長が無くても出せる', () => {
    expect(basalMetabolicRate(profileOf({ bodyWeightKg: 60, bodyFatPercent: 15 }))?.kcal).toBe(1472);
  });

  describe('出せない時', () => {
    it('体重が無ければ出さない', () => {
      expect(basalMetabolicRate(profileOf({}))).toBeNull();
      expect(whyNoBasal(profileOf({}))).toContain('体重');
    });

    it('体脂肪率も、身長・年齢・性別もそろっていなければ出さない', () => {
      const only = profileOf({ bodyWeightKg: 60, heightCm: 170 });
      expect(basalMetabolicRate(only)).toBeNull();
      // 何が足りないかを名指しする。
      expect(whyNoBasal(only)).toContain('年齢');
      expect(whyNoBasal(only)).toContain('性別');
      expect(whyNoBasal(only)).not.toContain('身長');
    });

    it('そろっていれば、理由は出さない', () => {
      expect(whyNoBasal(lean)).toBeNull();
      expect(whyNoBasal(measured)).toBeNull();
    });

    it('記録が無くても落ちない', () => {
      expect(basalMetabolicRate(null)).toBeNull();
      expect(whyNoBasal(null)).toContain('体重');
    });
  });
});

describe('その日の、使った量と食べた量', () => {
  const run: ActivityLog = {
    id: 'r',
    date: daysAgo(0),
    type: 'run',
    distanceKm: 10,
    durationMin: 50,
    createdAt: `${daysAgo(0)}T12:00:00.000Z`,
  };

  it('基礎代謝 ＋ 生活 ＋ 運動 を足す', () => {
    const energy = dayEnergy(profileOf({ ...lean, activities: [run] }), daysAgo(0));
    expect(energy.basal).toBe(1472);
    expect(energy.living).toBe(Math.round(1472 * (LIVING_FACTOR - 1)));
    expect(energy.exercise).toBeGreaterThan(500);
    expect(energy.burned).toBe(energy.basal! + energy.living! + energy.exercise);
  });

  /**
   * **運動の分だけを出しても、判断材料にならない。**
   * 10km走って約600kcal、基礎代謝は1,400kcal前後。
   */
  it('運動より、基礎代謝のほうが大きい', () => {
    const energy = dayEnergy(profileOf({ ...lean, activities: [run] }), daysAgo(0));
    expect(energy.basal!).toBeGreaterThan(energy.exercise);
  });

  it('走っていない日も、使った量は出る', () => {
    const energy = dayEnergy(lean, daysAgo(3));
    expect(energy.exercise).toBe(0);
    expect(energy.burned).toBeGreaterThan(1500);
  });

  it('食べた記録があれば、差を出す', () => {
    const profile = profileOf({
      ...lean,
      dailyLog: [{ date: daysAgo(0), opened: true, intakeKcal: 1800 }],
    });
    const energy = dayEnergy(profile, daysAgo(0));
    expect(energy.intake).toBe(1800);
    expect(energy.balance).toBe(1800 - energy.burned!);
  });

  it('食べた記録が無ければ、差は出さない（0 にしない）', () => {
    const energy = dayEnergy(lean, daysAgo(0));
    expect(energy.intake).toBeNull();
    expect(energy.balance).toBeNull();
  });

  it('基礎代謝が出せなければ、使った量も出さない', () => {
    const energy = dayEnergy(profileOf({ bodyWeightKg: 60 }), daysAgo(0));
    expect(energy.burned).toBeNull();
    expect(energy.balance).toBeNull();
  });
});

describe('足りているか', () => {
  const withIntake = (kcals: number[]): DailyRecord[] =>
    kcals.map((kcal, index) => ({ date: daysAgo(index), opened: true, intakeKcal: kcal }));

  /**
   * **ここが、この機能を作った理由。**
   * 基礎代謝は、1日じっと寝ていても使う量。これを下回る日が続くのは、
   * 疲労骨折・貧血・免疫の低下の入口。
   */
  it('基礎代謝を下回っていたら、はっきり言う', () => {
    const check = fuelCheck(
      profileOf({ ...lean, dailyLog: withIntake([1200, 1100, 1300, 1250]) }),
      { now: NOW },
    );
    expect(check?.level).toBe('low');
    const said = describeFuel(check!);
    expect(said.title).toContain('足りていません');
    expect(said.detail).toMatch(/疲労骨折|貧血/);
    // **走る量ではなく、食べる量のほうを見直させる。**
    expect(said.detail).toContain('食べる量');
  });

  /**
   * **走った日に、走った分を食べていない形。**
   * 走っていない日は、基礎代謝を上回っていれば不足は 300kcal 程度にしかならない。
   * 500kcal を超える不足が出るのは、走った日に食べ足していない時。
   */
  it('走った分を食べていなければ、様子を見るよう言う', () => {
    const runs: ActivityLog[] = [0, 1, 2, 3].map((ago) => ({
      id: `r${ago}`,
      date: daysAgo(ago),
      type: 'run' as const,
      distanceKm: 10,
      durationMin: 50,
      createdAt: `${daysAgo(ago)}T12:00:00.000Z`,
    }));
    const check = fuelCheck(
      profileOf({ ...lean, activities: runs, dailyLog: withIntake([1700, 1720, 1680, 1710]) }),
      { now: NOW },
    );
    expect(check?.level).toBe('watch');
    expect(check!.shortfall).toBeGreaterThan(0);
    expect(describeFuel(check!).detail).toContain('走った日は');
  });

  it('釣り合っていれば、足りていると言う', () => {
    const check = fuelCheck(
      profileOf({ ...lean, dailyLog: withIntake([1800, 1750, 1820, 1780]) }),
      { now: NOW },
    );
    expect(check?.level).toBe('ok');
    expect(describeFuel(check!).title).toContain('足りています');
  });

  /**
   * **食べすぎは見ない。** 数えた時点で、この画面は減量の道具になる。
   */
  it('食べすぎを警告しない', () => {
    const check = fuelCheck(
      profileOf({ ...lean, dailyLog: withIntake([3500, 3600, 3400, 3550]) }),
      { now: NOW },
    );
    expect(check?.level).toBe('ok');
    const said = describeFuel(check!);
    expect(`${said.title}${said.detail}`).not.toMatch(/多すぎ|食べすぎ|減らし/);
  });

  it('記録が少なければ、見立てを出さない', () => {
    expect(fuelCheck(profileOf({ ...lean, dailyLog: withIntake([1200, 1100]) }), { now: NOW }))
      .toBeNull();
  });

  it('基礎代謝が出せなければ、見立ても出さない', () => {
    const check = fuelCheck(
      profileOf({ bodyWeightKg: 60, dailyLog: withIntake([1200, 1100, 1300, 1250]) }),
      { now: NOW },
    );
    expect(check).toBeNull();
  });

  it('古い記録は見ない', () => {
    const old = [60, 61, 62, 63].map((ago) => ({
      date: daysAgo(ago),
      opened: true,
      intakeKcal: 1000,
    }));
    expect(fuelCheck(profileOf({ ...lean, dailyLog: old }), { now: NOW })).toBeNull();
  });

  it('様子を見る境目が決めてある', () => {
    expect(WATCH_SHORTFALL).toBe(500);
  });

  it('どの言い方にも、目標の数値を混ぜない', () => {
    for (const kcals of [[1200, 1100, 1300, 1250], [1500, 1520, 1480, 1510], [1800, 1750, 1820, 1780]]) {
      const check = fuelCheck(profileOf({ ...lean, dailyLog: withIntake(kcals) }), { now: NOW });
      const said = describeFuel(check!);
      expect(`${said.title}${said.detail}`).not.toMatch(/あと[\d,]+kcal|目標|まで食べ/);
    }
  });
});

/** 画面に生のまま出るので、文章に書式の記号を混ぜない。 */
it('画面に出る文章に、書式の記号を混ぜない', () => {
  const lean2 = profileOf({ bodyWeightKg: 60, bodyFatPercent: 15 });
  const texts = [ENERGY_NOTE];
  for (const kcals of [[1200, 1100, 1300], [1800, 1750, 1820]]) {
    const check = fuelCheck(
      profileOf({
        ...lean2,
        dailyLog: kcals.map((kcal, i) => ({ date: daysAgo(i), opened: true, intakeKcal: kcal })),
      }),
      { now: NOW },
    );
    const said = describeFuel(check!);
    texts.push(said.title, said.detail);
  }
  for (const text of texts) expect(text, text.slice(0, 20)).not.toContain('**');
});

it('減らすための道具ではないと、但し書きが言っている', () => {
  expect(ENERGY_NOTE).toContain('足りているか');
  expect(ENERGY_NOTE).toContain('減らすためのものではありません');
  expect(ENERGY_NOTE).toContain('目安');
});
