import { describe, expect, it } from 'vitest';
import {
  CALORIES_NOTE,
  burnsEnergy,
  estimateCalories,
  totalCalories,
  whyNoCalories,
} from '@/lib/calories';
import type { ActivityType } from '@/lib/types';

/**
 * 消費カロリー。
 *
 * **モデルに計算させない。** 「だいたい500kcalくらい」と自信たっぷりに
 * 書かれた数字は、体重も時間も見ていない。ここは決まった式で出す。
 * そのうえで、出せない時は**黙って 0 を出さない**。
 */

const run = (distanceKm: number, durationMin: number) =>
  ({ type: 'run' as ActivityType, distanceKm, durationMin });
const walk = (distanceKm: number, durationMin: number) =>
  ({ type: 'walk' as ActivityType, distanceKm, durationMin });

describe('消費カロリーの目安', () => {
  it('10kmを50分、60kgで、おおよそ650kcal', () => {
    const kcal = estimateCalories(run(10, 50), 60);
    expect(kcal).not.toBeNull();
    // 広く使われている概算（体重×距離×1.036 ≒ 620）と、1割の範囲で一致する。
    expect(kcal!).toBeGreaterThan(580);
    expect(kcal!).toBeLessThan(700);
  });

  it('3kmを36分 歩いて、60kgで、おおよそ130kcal', () => {
    const kcal = estimateCalories(walk(3, 36), 60);
    expect(kcal!).toBeGreaterThan(100);
    expect(kcal!).toBeLessThan(170);
  });

  it('体重が重いほど、多く消費する', () => {
    expect(estimateCalories(run(10, 50), 80)!).toBeGreaterThan(
      estimateCalories(run(10, 50), 50)!,
    );
  });

  it('同じ距離なら、速く走ったほうが時間あたりは高いが、総量は近い', () => {
    const fast = estimateCalories(run(10, 40), 60)!;
    const slow = estimateCalories(run(10, 60), 60)!;
    // 走る距離が同じなら総量は大きく変わらない（2割以内）。
    expect(Math.abs(fast - slow) / fast).toBeLessThan(0.2);
  });

  it('歩くより走るほうが、同じ距離でも多い', () => {
    expect(estimateCalories(run(5, 30), 60)!).toBeGreaterThan(
      estimateCalories(walk(5, 60), 60)!,
    );
  });

  it('整数で返す（小数点以下に意味は無い）', () => {
    expect(Number.isInteger(estimateCalories(run(10, 50), 60)!)).toBe(true);
  });

  describe('出せない時は null（0 ではない）', () => {
    it('体重が分からなければ出さない', () => {
      // 仮の体重で出すのは、当てずっぽうを数字の顔で出すこと。
      expect(estimateCalories(run(10, 50), undefined)).toBeNull();
      expect(estimateCalories(run(10, 50), 0)).toBeNull();
      expect(estimateCalories(run(10, 50), -5)).toBeNull();
      expect(estimateCalories(run(10, 50), NaN)).toBeNull();
    });

    it('距離か時間が欠けていれば出さない', () => {
      expect(estimateCalories({ type: 'run', distanceKm: 10 }, 60)).toBeNull();
      expect(estimateCalories({ type: 'run', durationMin: 50 }, 60)).toBeNull();
      expect(estimateCalories(run(0, 50), 60)).toBeNull();
      expect(estimateCalories(run(10, 0), 60)).toBeNull();
    });

    it('体を動かさない記録には出さない', () => {
      for (const type of ['rest', 'stretch', 'strength'] as ActivityType[]) {
        expect(estimateCalories({ type, distanceKm: 5, durationMin: 30 }, 60), type).toBeNull();
        expect(burnsEnergy(type), type).toBe(false);
      }
      for (const type of ['run', 'walk', 'cross'] as ActivityType[]) {
        expect(burnsEnergy(type), type).toBe(true);
      }
    });

    it('ありえない速さは、読み違いとして出さない', () => {
      // 100km を 10分（時速600km）。画像の読み取り誤りで起きる。
      expect(estimateCalories(run(100, 10), 60)).toBeNull();
      // 1km を 10時間。止まっている。
      expect(estimateCalories(run(1, 600), 60)).toBeNull();
    });
  });

  describe('まとめた目安', () => {
    it('出せた分だけを足す', () => {
      const total = totalCalories([run(10, 50), run(5, 25)], 60);
      expect(total).toBe(estimateCalories(run(10, 50), 60)! + estimateCalories(run(5, 25), 60)!);
    });

    it('出せない記録を 0 として混ぜない', () => {
      const withRest = totalCalories([run(10, 50), { type: 'rest' }], 60);
      expect(withRest).toBe(estimateCalories(run(10, 50), 60));
    });

    it('1つも出せなければ null', () => {
      expect(totalCalories([{ type: 'rest' }], 60)).toBeNull();
      expect(totalCalories([], 60)).toBeNull();
      expect(totalCalories([run(10, 50)], undefined)).toBeNull();
    });
  });

  describe('出せない理由を言う', () => {
    it('体重が無い時は、記録すれば出ることを伝える', () => {
      expect(whyNoCalories(run(10, 50), undefined)).toContain('体重');
    });

    it('距離か時間が欠けている時は、そう言う', () => {
      expect(whyNoCalories({ type: 'run', distanceKm: 10 }, 60)).toContain('距離と時間');
    });

    it('出せている時は、何も言わない', () => {
      expect(whyNoCalories(run(10, 50), 60)).toBeNull();
    });

    it('もともと出さない記録には、理由も出さない', () => {
      expect(whyNoCalories({ type: 'rest' }, undefined)).toBeNull();
    });
  });

  it('目安であることを、注意書きが言っている', () => {
    expect(CALORIES_NOTE).toContain('目安');
    expect(CALORIES_NOTE).toMatch(/変わり|幅/);
  });
});
