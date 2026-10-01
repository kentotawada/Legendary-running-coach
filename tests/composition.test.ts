import { describe, expect, it } from 'vitest';
import {
  MEASURE_NOTE,
  MIN_HEALTHY_BMI,
  bmiOf,
  compositionChange,
  describeChange,
  fatMassKg,
  isBodyFatInRange,
  isHeightInRange,
  leanMassKg,
  minHealthyWeightKg,
} from '@/lib/composition';
import { weightOutlook } from '@/lib/forecast';
import { createDefaultProfile } from '@/lib/types';
import type { DailyRecord, RunnerProfile } from '@/lib/types';

/**
 * 体組成。
 *
 * **同じ「3kg減」でも、中身が正反対のことがある。**
 * 体重だけを見ていると、脂肪が減ったのか筋肉と骨が減ったのかが同じ数字に見える。
 * 走る人にとって後者は、疲労骨折と貧血の入口。
 */

const NOW = new Date('2026-09-15T12:00:00+09:00');

function daysAgo(n: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/** [何日前, 体重, 体脂肪率] */
function log(entries: [number, number, number?][]): DailyRecord[] {
  return entries.map(([ago, kg, fat]) => ({
    date: daysAgo(ago),
    opened: true,
    weightKg: kg,
    ...(fat === undefined ? {} : { bodyFatPercent: fat }),
  }));
}

const profileOf = (extra: Partial<RunnerProfile>): RunnerProfile => ({
  ...createDefaultProfile('t'),
  ...extra,
});

describe('脂肪と、それ以外', () => {
  it('分けて出す', () => {
    expect(fatMassKg(60, 20)).toBe(12);
    expect(leanMassKg(60, 20)).toBe(48);
  });

  it('受け取る範囲を決めてある', () => {
    expect(isBodyFatInRange(18)).toBe(true);
    expect(isBodyFatInRange(2)).toBe(false);
    expect(isBodyFatInRange(70)).toBe(false);
    expect(isBodyFatInRange(undefined)).toBe(false);
    expect(isBodyFatInRange(NaN)).toBe(false);
    expect(isHeightInRange(170)).toBe(true);
    expect(isHeightInRange(50)).toBe(false);
    expect(isHeightInRange(undefined)).toBe(false);
  });
});

describe('健康の下限', () => {
  it('身長があれば、BMI で止める', () => {
    // 170cm → 18.5 × 1.7² = 53.5kg
    expect(minHealthyWeightKg(170)).toBeCloseTo(53.5, 1);
    expect(bmiOf(60, 170)).toBeCloseTo(20.8, 1);
  });

  it('身長が無ければ、下限は出せない（呼ぶ側が粗い下限に落とす）', () => {
    expect(minHealthyWeightKg(undefined)).toBeNull();
    expect(bmiOf(60, undefined)).toBeNull();
  });

  it('下限は痩せすぎの境目に置く', () => {
    expect(MIN_HEALTHY_BMI).toBe(18.5);
  });

  /**
   * **「いまの体重の10%まで」は、身長を知らない時の間に合わせ。**
   * 50kg の人と 90kg の人で、同じ10%が意味することはまったく違う。
   */
  it('身長が分かると、見込みの下限が BMI に変わる', () => {
    const weighing = log([
      [90, 58], [75, 57], [60, 56], [45, 55], [30, 54], [15, 53], [0, 52],
    ]);
    const withoutHeight = weightOutlook(profileOf({ dailyLog: weighing }), NOW);
    const withHeight = weightOutlook(profileOf({ dailyLog: weighing, heightCm: 170 }), NOW);

    expect(withoutHeight.ready && withHeight.ready).toBe(true);
    if (!withoutHeight.ready || !withHeight.ready) return;

    expect(withoutHeight.floorBasis).toBe('ratio');
    expect(withHeight.floorBasis).toBe('bmi');
    // 170cm なら 53.5kg が下限。52kg の人には、割合（46.8kg）より厳しい。
    expect(withHeight.floor).toBeGreaterThan(withoutHeight.floor);
    expect(withHeight.low).toBeGreaterThanOrEqual(withHeight.floor - 0.05);
  });
});

describe('何が減ったのか', () => {
  it('脂肪が中心に減っていれば、そう言う', () => {
    // 70kg/22% → 67kg/18.5%。脂肪 15.4→12.4kg、除脂肪 54.6→54.6kg
    const change = compositionChange(
      profileOf({
        dailyLog: log([
          [60, 70, 22], [55, 70, 22], [50, 69.8, 21.8],
          [10, 67.2, 18.7], [5, 67, 18.5], [0, 67, 18.5],
        ]),
      }),
      { now: NOW },
    );
    expect(change).not.toBeNull();
    expect(change!.kind).toBe('fat');
    expect(change!.fatKg).toBeLessThan(0);
    expect(Math.abs(change!.leanKg)).toBeLessThan(0.5);
    expect(describeChange(change!).title).toContain('脂肪');
  });

  /**
   * **ここが、この機能を作った理由。**
   * 体重だけ見ていると「3kg減って順調」に見えるが、
   * 落ちているのが筋肉なら、疲労骨折と貧血の入口。
   */
  it('減っているのが筋肉なら、はっきりそう言う', () => {
    // 70kg/18% → 67kg/18.6%。脂肪 12.6→12.5kg、除脂肪 57.4→54.5kg
    const change = compositionChange(
      profileOf({
        dailyLog: log([
          [60, 70, 18], [55, 70, 18], [50, 69.8, 18.1],
          [10, 67.2, 18.5], [5, 67, 18.6], [0, 67, 18.6],
        ]),
      }),
      { now: NOW },
    );
    expect(change!.kind).toBe('lean');
    expect(change!.leanKg).toBeLessThan(change!.fatKg);
    const said = describeChange(change!);
    expect(said.title).toContain('脂肪ではありません');
    expect(said.detail).toMatch(/疲労骨折|貧血/);
    expect(said.detail).toContain('食べる量');
  });

  it('両方減っていれば、そう言う', () => {
    const change = compositionChange(
      profileOf({
        dailyLog: log([
          [60, 70, 20], [55, 70, 20], [50, 69.8, 19.9],
          [10, 67.2, 18.6], [5, 67, 18.5], [0, 67, 18.5],
        ]),
      }),
      { now: NOW },
    );
    expect(change!.kind).toBe('mixed');
    expect(describeChange(change!).detail).toContain('食べる量');
  });

  it('増えている人を、減らすよう促さない', () => {
    const change = compositionChange(
      profileOf({
        dailyLog: log([
          [60, 62, 16], [55, 62, 16], [50, 62.2, 16],
          [10, 64.8, 16], [5, 65, 16], [0, 65, 16],
        ]),
      }),
      { now: NOW },
    );
    expect(change!.kind).toBe('gain');
    expect(describeChange(change!).detail).not.toMatch(/減らし|落とし/);
  });

  it('体組成計の振れ幅より小さい変化は、変化として扱わない', () => {
    const change = compositionChange(
      profileOf({
        dailyLog: log([
          [60, 62, 18], [55, 62.1, 18.1], [50, 61.9, 17.9],
          [10, 62.1, 18], [5, 62, 18.1], [0, 61.9, 17.9],
        ]),
      }),
      { now: NOW },
    );
    expect(change!.kind).toBe('flat');
  });

  describe('出さない時', () => {
    it('体脂肪率が無ければ出さない（体重だけでは分けられない）', () => {
      const change = compositionChange(
        profileOf({ dailyLog: log([[60, 70], [50, 69], [40, 68], [30, 67], [20, 66], [0, 65]]) }),
        { now: NOW },
      );
      expect(change).toBeNull();
    });

    it('回数が足りなければ出さない', () => {
      const change = compositionChange(
        profileOf({ dailyLog: log([[60, 70, 20], [0, 67, 18]]) }),
        { now: NOW },
      );
      expect(change).toBeNull();
    });

    it('期間が短ければ出さない（1週間の揺れで筋肉が減ったことにしない）', () => {
      const change = compositionChange(
        profileOf({
          dailyLog: log([
            [5, 70, 20], [4, 70, 20], [3, 69, 19.5],
            [2, 68.5, 19.3], [1, 68, 19], [0, 68, 19],
          ]),
        }),
        { now: NOW },
      );
      expect(change).toBeNull();
    });

    it('範囲の外の体脂肪率は、使わない', () => {
      const change = compositionChange(
        profileOf({
          dailyLog: log([
            [60, 70, 200], [55, 70, 200], [50, 69.8, 200],
            [10, 67.2, 200], [5, 67, 200], [0, 67, 200],
          ]),
        }),
        { now: NOW },
      );
      expect(change).toBeNull();
    });

    it('記録が無くても落ちない', () => {
      expect(compositionChange(null, { now: NOW })).toBeNull();
      expect(compositionChange(profileOf({}), { now: NOW })).toBeNull();
    });
  });

  /**
   * 家庭用の体組成計は、絶対値がずれる（脱水だけで1〜3ポイント動く）。
   * 走った直後に乗ると、体脂肪率が高めに出る。
   */
  it('測り方の案内が、走る人の落とし穴に触れている', () => {
    expect(MEASURE_NOTE).toContain('走った直後');
    expect(MEASURE_NOTE).toContain('脱水');
    expect(MEASURE_NOTE).toMatch(/向き/);
  });

  it('どの言い方にも、体脂肪率の目標値を混ぜない', () => {
    const cases: [number, number, number][][] = [
      [[60, 70, 22], [55, 70, 22], [50, 69.8, 21.8], [10, 67.2, 18.7], [5, 67, 18.5], [0, 67, 18.5]],
      [[60, 70, 18], [55, 70, 18], [50, 69.8, 18.1], [10, 67.2, 18.5], [5, 67, 18.6], [0, 67, 18.6]],
      [[60, 62, 16], [55, 62, 16], [50, 62.2, 16], [10, 64.8, 16], [5, 65, 16], [0, 65, 16]],
    ];
    for (const entries of cases) {
      const change = compositionChange(profileOf({ dailyLog: log(entries) }), { now: NOW });
      const said = describeChange(change!);
      expect(`${said.title}${said.detail}`).not.toMatch(/%まで|目標.*%|まで落と/);
    }
  });
});
