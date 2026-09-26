import { describe, expect, it } from 'vitest';
import { heartRateZones, timeInZones } from '@/lib/zones';
import { hrHistogram } from '@/lib/workout';
import { createDefaultProfile } from '@/lib/types';

/**
 * ゾーンごとの時間。
 *
 * **記録にゾーンを焼き込まない。** 最大心拍は後から変わる。
 * 変わった時に過去の練習が古いゾーンのまま残ると、見比べが嘘になる。
 */

const zonesFor = (maxHr: number) =>
  heartRateZones({ ...createDefaultProfile('u1', '2026-09-25T00:00:00Z'), maxHr }).zones;

describe('hrHistogram', () => {
  it('心拍ごとに、そこに居た秒数を積む', () => {
    const samples = [
      { t: 0, hr: 150 },
      { t: 10, hr: 150 },
      { t: 20, hr: 160 },
      { t: 30, hr: 160 },
    ];
    expect(hrHistogram(samples)).toEqual([
      [150, 20],
      [160, 10],
    ]);
  });

  /** 止まっていた時間を走ったことにしない。 */
  it('長く空いた区間は数えない', () => {
    const samples = [
      { t: 0, hr: 150 },
      { t: 10, hr: 150 },
      // ここで5分止まっている
      { t: 310, hr: 120 },
      { t: 320, hr: 155 },
    ];
    const histogram = hrHistogram(samples)!;
    // 止まっていた5分は、どの心拍にも積まれない。
    // 止まる直前の1点は、それがいつまで続いたか分からないので数えない。
    const total = histogram.reduce((sum, [, seconds]) => sum + seconds, 0);
    expect(total).toBe(20);
    expect(histogram.find(([bpm]) => bpm === 150)).toEqual([150, 10]);
  });

  it('心拍が1点も無ければ、持たない', () => {
    expect(hrHistogram([{ t: 0 }, { t: 10 }])).toBeUndefined();
  });

  it('あり得ない心拍は落とす', () => {
    expect(hrHistogram([{ t: 0, hr: 500 }, { t: 10, hr: 500 }])).toBeUndefined();
  });
});

describe('timeInZones', () => {
  it('心拍ごとの秒数を、ゾーンへ振り分ける', () => {
    const zones = zonesFor(190);
    // Z1 〜123 / Z2 124〜141 / Z3 142〜160 / Z4 161〜174 / Z5 175〜190
    const rows = timeInZones(
      [
        [120, 60],
        [150, 600],
        [170, 300],
      ],
      zones,
    );

    expect(rows).toHaveLength(5);
    expect(rows[0].seconds).toBe(60);
    expect(rows[2].seconds).toBe(600);
    expect(rows[3].seconds).toBe(300);
    // 割合の合計は1になる
    expect(rows.reduce((sum, row) => sum + row.ratio, 0)).toBeCloseTo(1, 6);
  });

  /** **同じ練習でも、ゾーンを直せば集計も直る。** ここが焼き込まないことの価値。 */
  it('最大心拍を直すと、集計もその場で変わる', () => {
    const histogram: [number, number][] = [[165, 600]];
    const before = timeInZones(histogram, zonesFor(190));
    const after = timeInZones(histogram, zonesFor(210));

    const zoneOf = (rows: ReturnType<typeof timeInZones>) => rows.findIndex((row) => row.seconds > 0);
    expect(zoneOf(before)).toBeGreaterThan(zoneOf(after));
  });

  it('心拍が無ければ、何も出さない', () => {
    expect(timeInZones(undefined, zonesFor(190))).toEqual([]);
    expect(timeInZones([], zonesFor(190))).toEqual([]);
  });

  it('ゾーンが決められない人には、何も出さない', () => {
    const none = heartRateZones(createDefaultProfile('u1', '2026-09-25T00:00:00Z')).zones;
    expect(timeInZones([[150, 600]], none)).toEqual([]);
  });
});
