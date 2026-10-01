import { describe, expect, it } from 'vitest';
import {
  HORIZON_WEEKS,
  OUTLOOK_NOTE,
  goalOutlook,
  paceOutlook,
  weightOutlook,
} from '@/lib/forecast';
import { createDefaultProfile } from '@/lib/types';
import type { ActivityLog, RunnerProfile } from '@/lib/types';

/**
 * 3か月後の見込み。
 *
 * **ここはいちばん嘘をつきやすい場所。** 線を引いて伸ばすだけなら誰でもできるが、
 * その線は現実には続かない。守っているのは4つ:
 * 幅で出す / 伸びは鈍る / 体重には下限を置く / 足りないデータでは出さない。
 */

const NOW = new Date('2026-09-15T12:00:00+09:00');

function daysAgo(n: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function weighing(entries: [number, number][]): Partial<RunnerProfile> {
  return {
    dailyLog: entries.map(([ago, kg]) => ({ date: daysAgo(ago), opened: true, weightKg: kg })),
  };
}

function running(entries: [number, number, number][]): ActivityLog[] {
  return entries.map(([ago, km, min]) => ({
    id: `a${ago}`,
    date: daysAgo(ago),
    type: 'run' as const,
    distanceKm: km,
    durationMin: min,
    createdAt: `${daysAgo(ago)}T12:00:00.000Z`,
  }));
}

const profileOf = (extra: Partial<RunnerProfile>): RunnerProfile => ({
  ...createDefaultProfile('t'),
  ...extra,
});

describe('3か月後の体重', () => {
  it('ゆっくり減っている人には、減った先を幅で出す', () => {
    // 60日で 2kg（週 約0.23kg）。健康的な速さ。
    const out = weightOutlook(
      profileOf(weighing([[60, 70], [50, 69.7], [40, 69.4], [30, 69], [20, 68.7], [10, 68.3], [0, 68]])),
      NOW,
    );
    expect(out.ready).toBe(true);
    if (!out.ready) return;
    expect(out.direction).toBe('down');
    expect(out.now).toBeCloseTo(68, 0);
    // 13週ぶん減る見込み。幅があって、低いほうが高いほうより小さい。
    expect(out.low).toBeLessThan(out.high);
    expect(out.high).toBeLessThan(out.now);
    expect(out.tooFast).toBe(false);
    expect(out.floored).toBe(false);
  });

  /**
   * **落ちる線をそのまま伸ばさない。**
   * 2週間で2kg落ちた人の線を13週伸ばすと13kgになる。
   * そんな減り方は続かないし、続いたら体を壊す。
   */
  it('速すぎる減り方は、安全な速さに丸めて「速すぎる」と言う', () => {
    // 21日で 4kg（週 約1.3kg = 2%/週）。速すぎる。
    const out = weightOutlook(
      profileOf(weighing([[21, 70], [18, 69.3], [14, 68.5], [10, 67.6], [6, 66.8], [3, 66.3], [0, 66]])),
      NOW,
    );
    expect(out.ready).toBe(true);
    if (!out.ready) return;
    expect(out.tooFast).toBe(true);
    // 丸めたあとの速さは、丸める前より緩やかになっている。
    expect(out.perWeek).toBeGreaterThan(out.rawPerWeek);
    // 1週あたり、いまの体重の1%まで。
    expect(Math.abs(out.perWeek)).toBeLessThanOrEqual(out.now * 0.01 + 0.01);
  });

  it('どんな傾きでも、いまの体重の10%より下は見込みに出さない', () => {
    // 極端に速い減り方。
    const out = weightOutlook(
      profileOf(weighing([[28, 80], [24, 77], [20, 74], [16, 71], [12, 68], [6, 65], [0, 62]])),
      NOW,
    );
    expect(out.ready).toBe(true);
    if (!out.ready) return;
    expect(out.low).toBeGreaterThanOrEqual(out.now * 0.9 - 0.05);
  });

  it('増えている人には、増えた先を出す（減量を押しつけない）', () => {
    const out = weightOutlook(
      profileOf(weighing([[60, 60], [50, 60.3], [40, 60.6], [30, 61], [20, 61.3], [10, 61.6], [0, 62]])),
      NOW,
    );
    expect(out.ready).toBe(true);
    if (!out.ready) return;
    expect(out.direction).toBe('up');
    expect(out.low).toBeGreaterThan(out.now);
    expect(out.tooFast).toBe(false);
  });

  it('ほとんど変わっていない人には、変わらない見込みを出す', () => {
    const out = weightOutlook(
      profileOf(weighing([[60, 62], [50, 62.1], [40, 61.9], [30, 62], [20, 62.1], [10, 61.9], [0, 62]])),
      NOW,
    );
    expect(out.ready).toBe(true);
    if (!out.ready) return;
    expect(out.direction).toBe('flat');
  });

  it('記録が少なければ、出さずに「あと何回」を言う', () => {
    const out = weightOutlook(profileOf(weighing([[10, 62], [0, 61.8]])), NOW);
    expect(out.ready).toBe(false);
    if (out.ready) return;
    expect(out.reason).toContain('あと');
  });

  it('同じ日に固まった記録では、線を引かない', () => {
    // 回数はあっても、期間が短ければ傾きは信用できない。
    const out = weightOutlook(
      profileOf(weighing([[2, 62], [2, 62], [1, 61.8], [1, 61.8], [0, 61.6], [0, 61.6]])),
      NOW,
    );
    expect(out.ready).toBe(false);
  });

  it('記録が無くても落ちない', () => {
    expect(weightOutlook(null, NOW).ready).toBe(false);
    expect(weightOutlook(profileOf({}), NOW).ready).toBe(false);
  });
});

describe('3か月後の練習ペース', () => {
  /**
   * **直線で伸ばさない。** 練習の効果は最初が大きく、だんだん鈍る。
   * 直線のまま13週伸ばすと、ありえない数字になる。
   */
  it('速くなっている人の伸びは、直線より小さく見積もる', () => {
    // 60日で 30秒/km 速くなっている（週 約3.5秒）。
    const out = paceOutlook(
      profileOf({
        activities: running([
          [60, 10, 60], [50, 10, 59], [40, 10, 58.5], [30, 10, 58],
          [20, 10, 57.5], [10, 10, 57], [0, 10, 56],
        ]),
      }),
      NOW,
    );
    expect(out.ready).toBe(true);
    if (!out.ready) return;
    expect(out.direction).toBe('faster');
    expect(out.fast).toBeLessThan(out.now);
    // 直線なら 13週 × 傾き ぶん速くなるはず。減衰でそれより小さいこと。
    const straight = Math.abs(out.perWeek) * HORIZON_WEEKS;
    expect(out.now - out.fast).toBeLessThan(straight);
  });

  it('速い側と遅い側の、幅で出す', () => {
    const out = paceOutlook(
      profileOf({
        activities: running([
          [60, 10, 60], [50, 10, 59], [40, 10, 58.5], [30, 10, 58],
          [20, 10, 57.5], [10, 10, 57], [0, 10, 56],
        ]),
      }),
      NOW,
    );
    if (!out.ready) throw new Error('出るはず');
    expect(out.fast).toBeLessThan(out.slow);
  });

  it('どれだけ伸びても、ありえない速さにはしない', () => {
    // 毎回ものすごく速くなっている記録。
    const out = paceOutlook(
      profileOf({
        activities: running([
          [60, 10, 90], [50, 10, 80], [40, 10, 70], [30, 10, 60],
          [20, 10, 50], [10, 10, 42], [0, 10, 35],
        ]),
      }),
      NOW,
    );
    if (!out.ready) throw new Error('出るはず');
    // 2:30/km より速い見込みは出さない。
    expect(out.fast).toBeGreaterThanOrEqual(150);
  });

  it('遅くなっている人にも、そのまま伝える（良く見せない）', () => {
    const out = paceOutlook(
      profileOf({
        activities: running([
          [60, 10, 55], [50, 10, 56], [40, 10, 57], [30, 10, 58],
          [20, 10, 59], [10, 10, 60], [0, 10, 61],
        ]),
      }),
      NOW,
    );
    if (!out.ready) throw new Error('出るはず');
    expect(out.direction).toBe('slower');
    expect(out.slow).toBeGreaterThan(out.now);
  });

  it('記録が少なければ、出さずに「あと何回」を言う', () => {
    const out = paceOutlook(profileOf({ activities: running([[10, 10, 55], [0, 10, 54]]) }), NOW);
    expect(out.ready).toBe(false);
    if (out.ready) return;
    expect(out.reason).toContain('あと');
  });

  it('記録が無くても落ちない', () => {
    expect(paceOutlook(null, NOW).ready).toBe(false);
    expect(paceOutlook(profileOf({}), NOW).ready).toBe(false);
  });
});

describe('目標に届きそうか', () => {
  const fastening = profileOf({
    activities: running([
      [60, 10, 60], [50, 10, 59], [40, 10, 58.5], [30, 10, 58],
      [20, 10, 57.5], [10, 10, 57], [0, 10, 56],
    ]),
  });

  it('届く位置なら、そう言う', () => {
    const pace = paceOutlook(fastening, NOW);
    const goal = goalOutlook(fastening, pace, 400); // 6:40/km
    expect(goal?.reaching).toBe(true);
    expect(goal?.summary).toContain('並ぶ');
  });

  it('届かないなら、あと何秒かを言う', () => {
    const pace = paceOutlook(fastening, NOW);
    const goal = goalOutlook(fastening, pace, 240); // 4:00/km
    expect(goal?.reaching).toBe(false);
    expect(goal?.gap).toBeGreaterThan(0);
    expect(goal?.summary).toContain('秒/km');
  });

  it('目標が無ければ、何も出さない', () => {
    expect(goalOutlook(fastening, paceOutlook(fastening, NOW), undefined)).toBeNull();
  });

  it('ペースの見込みが出ていなければ、何も出さない', () => {
    expect(goalOutlook(null, { ready: false, reason: 'x' }, 300)).toBeNull();
  });
});

it('約束ではないことを、但し書きが言っている', () => {
  expect(OUTLOOK_NOTE).toContain('約束ではありません');
  expect(OUTLOOK_NOTE).toContain('このまま続いた場合');
});
