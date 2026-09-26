import { describe, expect, it } from 'vitest';
import { scaleOf, ticksFor } from '@/components/RunCharts';

/**
 * グラフの縦軸。
 * **変わらなかった項目を、枠線に見せない。**
 */
describe('scaleOf', () => {
  it('ふつうの幅は、そのまま使う', () => {
    expect(scaleOf(150, 170)).toEqual({ base: 150, span: 20 });
  });

  it('ずっと同じ値なら、真ん中に置く', () => {
    const { base, span } = scaleOf(132, 132);
    // 値が中央（0.5）に来る＝線が上端にも下端にも貼りつかない。
    expect((132 - base) / span).toBe(0.5);
  });

  it('幅を0にしない', () => {
    expect(scaleOf(9.4, 9.4).span).toBeGreaterThan(0);
  });
});

/**
 * 横軸の目盛り。
 * **きりの良い数にだけ置く。** 端数の目盛りは、読むたびに計算させることになる。
 */
describe('ticksFor', () => {
  const DISTANCE = [0.2, 0.5, 1, 2, 5, 10, 20];
  const TIME = [60, 300, 600, 900, 1800, 3600];

  it('18kmの練習は、5kmごとに刻む', () => {
    expect(ticksFor(0, 17.7, DISTANCE)).toEqual([0, 5, 10, 15]);
  });

  it('5kmの練習は、もっと細かく刻む', () => {
    expect(ticksFor(0, 5.2, DISTANCE)).toEqual([0, 2, 4]);
  });

  it('1kmに満たない練習でも、目盛りが出る', () => {
    expect(ticksFor(0, 0.8, DISTANCE).length).toBeGreaterThan(1);
  });

  it('76分の練習は、30分ごとに刻む', () => {
    expect(ticksFor(0, 4560, TIME)).toEqual([0, 1800, 3600]);
  });

  it('目盛りを増やしすぎない', () => {
    for (const max of [0.4, 3, 12, 42.2, 160]) {
      expect(ticksFor(0, max, DISTANCE).length).toBeLessThanOrEqual(6);
    }
  });

  it('端の目盛りが、グラフの外にはみ出さない', () => {
    for (const max of [0.9, 4.4, 17.7, 42.195]) {
      const ticks = ticksFor(0, max, DISTANCE);
      expect(Math.max(...ticks)).toBeLessThanOrEqual(max);
      expect(Math.min(...ticks)).toBeGreaterThanOrEqual(0);
    }
  });

  it('幅が無い時は、目盛りを置かない', () => {
    expect(ticksFor(0, 0, DISTANCE)).toEqual([]);
  });
});
