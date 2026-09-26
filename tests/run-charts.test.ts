import { describe, expect, it } from 'vitest';
import { axisFor, xTicksFor } from '@/components/RunCharts';

/**
 * グラフの軸。
 * **目盛りは、きりの良い値にだけ立てる。** 半端な位置に立つと、
 * いくつの線なのかを読むたびに計算させることになる。
 */
describe('axisFor', () => {
  it('きりの良い値まで外へ広げる', () => {
    // 心拍 150〜168 → 140〜170 の間を10ずつ
    const axis = axisFor(150, 168);
    expect(axis.ticks[0]).toBeLessThanOrEqual(150);
    expect(axis.ticks[axis.ticks.length - 1]).toBeGreaterThanOrEqual(168);
    expect(axis.base + axis.span).toBe(axis.ticks[axis.ticks.length - 1]);
  });

  it('目盛りを増やしすぎない', () => {
    for (const [low, high] of [
      [150, 168],
      [9.2, 9.6],
      [226, 238],
      [0, 592],
      [130, 134],
    ]) {
      expect(axisFor(low, high).ticks.length).toBeLessThanOrEqual(6);
      expect(axisFor(low, high).ticks.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('ずっと同じ値でも、軸がつぶれない', () => {
    const axis = axisFor(132, 132);
    expect(axis.span).toBeGreaterThan(0);
    // 値が真ん中に来る＝線が上端にも下端にも貼りつかない。
    expect((132 - axis.base) / axis.span).toBeCloseTo(0.5, 5);
  });

  it('ペースは、秒の刻みで区切る', () => {
    // 4:31〜6:02（271〜362秒）。30秒ごとなら 270・300・330・360。
    const axis = axisFor(271, 362, [10, 15, 30, 60, 120, 300, 600]);
    expect(axis.ticks).toEqual([270, 300, 330, 360, 390]);
  });

  it('データが軸の外へはみ出さない', () => {
    for (const [low, high] of [
      [271, 362],
      [9.2, 9.6],
      [0, 592],
      [150.4, 168.9],
    ]) {
      const axis = axisFor(low, high);
      expect(axis.base).toBeLessThanOrEqual(low);
      expect(axis.base + axis.span).toBeGreaterThanOrEqual(high);
    }
  });
});

/**
 * 横軸は等間隔に割る。時計の画面がそうなっているので、同じ形に揃える。
 */
describe('xTicksFor', () => {
  it('端から端までを、6つに割る', () => {
    const ticks = xTicksFor(0, 5120);
    expect(ticks).toHaveLength(6);
    expect(ticks[0]).toBe(0);
    expect(ticks[5]).toBe(5120);
    expect(ticks[1] - ticks[0]).toBeCloseTo(ticks[2] - ticks[1], 6);
  });

  it('はじまりが0でなくても、そこから割る', () => {
    const ticks = xTicksFor(10, 5130);
    expect(ticks[0]).toBe(10);
    expect(ticks[5]).toBe(5130);
  });

  it('幅が無い時は、1つだけ返す', () => {
    expect(xTicksFor(0, 0)).toEqual([0]);
  });
});
