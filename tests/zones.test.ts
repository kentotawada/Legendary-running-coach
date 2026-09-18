import { describe, expect, it } from 'vitest';
import { estimateLthr, estimateMaxHrFromAge, heartRateZones, zoneDoctrine } from '@/lib/zones';
import { createDefaultProfile } from '@/lib/types';
import { applyProfileUpdate } from '@/lib/profile';

const NOW = new Date('2026-09-17T09:00:00Z');
const withHr = (patch: { maxHr?: number; lthr?: number; restingHr?: number }) =>
  applyProfileUpdate(createDefaultProfile('u1'), patch, NOW);

describe('heartRateZones', () => {
  it('最大心拍だけでもゾーンを出せる（空欄でエラーにしない）', () => {
    const table = heartRateZones(withHr({ maxHr: 190 }));

    expect(table.basis).toBe('max');
    expect(table.zones).toHaveLength(5);
    expect(table.zones[1].range).toBe('124〜142'); // Z2 = 65〜75%
    expect(table.estimateNote).toContain('推定値');
  });

  it('安静時心拍があれば、予備心拍ベースに切り替わる', () => {
    const table = heartRateZones(withHr({ maxHr: 190, restingHr: 45 }));

    expect(table.basis).toBe('reserve');
    // Z2 下限 = 45 + (190-45) * 0.6 = 132
    expect(table.zones[1].range.startsWith('132')).toBe(true);
  });

  it('LTHR があれば、それを最優先で使う', () => {
    const table = heartRateZones(withHr({ maxHr: 190, restingHr: 45, lthr: 172 }));

    expect(table.basis).toBe('lthr');
    expect(table.basisLabel).toContain('172');
    // Z4 は LTHR の 94〜99%
    expect(table.zones[3].range).toBe('162〜171');
    expect(table.estimateNote).toBeUndefined();
  });

  it('何も無ければゾーンを作らず、尋ねる判断ができる形で返す', () => {
    const table = heartRateZones(createDefaultProfile('u1'));

    expect(table.basis).toBe('none');
    expect(table.zones).toHaveLength(0);
  });

  it('ゾーンは重ならず、強度順に上がっていく', () => {
    const table = heartRateZones(withHr({ maxHr: 190, restingHr: 45 }));
    const lowerBounds = table.zones.slice(1).map((z) => Number(z.range.split('〜')[0]));

    for (let i = 1; i < lowerBounds.length; i += 1) {
      expect(lowerBounds[i]).toBeGreaterThan(lowerBounds[i - 1]);
    }
  });
});

describe('推定値', () => {
  it('LTHR は最大心拍の89%を目安にする', () => {
    expect(estimateLthr(190)).toBe(169);
  });

  it('最大心拍は 220 − 年齢 を目安にする', () => {
    expect(estimateMaxHrFromAge(38)).toBe(182);
  });
});

describe('zoneDoctrine', () => {
  it('空欄があっても、計算済みのゾーンをコーチに渡す', () => {
    const text = zoneDoctrine(withHr({ maxHr: 190 }));

    expect(text).toContain('Z2 イージー');
    expect(text).toContain('推定値を使った時は、その旨を一言添える');
  });

  it('心拍が何も無ければ、推測を禁じて尋ねさせる', () => {
    const text = zoneDoctrine(createDefaultProfile('u1'));

    expect(text).toContain('推測した心拍で語ってはならない');
    expect(text).toContain('220−年齢');
  });
});
