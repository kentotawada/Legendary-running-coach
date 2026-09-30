import { describe, expect, it } from 'vitest';
import { dayRow, retentionOf } from '@/lib/admin';

/**
 * ベータで見たい数。
 *
 * **初日の人数ではなく、3日目・7日目に何人残ったかが答え。**
 * 20人来て3日目に2人なら、それが答え。3人でも1週間続けば、それは本物。
 * 個人は追わない。誰が続けたかは要らない。何人続いたかが分かればいい。
 */

const day = (n: number) => `2026-09-${String(30 - n).padStart(2, '0')}`;

/** rows は新しい順に並ぶ。users は「その日に1回以上話した人」。 */
const rows = (users: number[]) =>
  users.map((count, i) => dayRow(day(i), { [`users:${day(i)}`]: count }, null));

describe('続いているかを読む', () => {
  it('いちばん多かった日と、延べの人数を出す', () => {
    const r = retentionOf(rows([3, 4, 6, 20, 0, 0, 0]));
    expect(r.peakUsers).toBe(20);
    expect(r.activeDays).toBe(33);
  });

  it('誰かが話した日を数える', () => {
    expect(retentionOf(rows([1, 0, 2, 0, 3, 0, 0])).daysWithUse).toBe(3);
  });

  /** **火が消えていないか。** ここが false なら、もう誰も来ていない。 */
  it('直近3日に誰も話していなければ、止まったと分かる', () => {
    expect(retentionOf(rows([0, 0, 0, 9, 9, 9, 9])).aliveNow).toBe(false);
    expect(retentionOf(rows([0, 0, 1, 0, 0, 0, 0])).aliveNow).toBe(true);
  });

  /** 8日前より古い日は、直近7日の数に混ぜない。 */
  it('直近7日だけを見る', () => {
    const r = retentionOf(rows([1, 1, 1, 1, 1, 1, 1, 100, 100]));
    expect(r.activeDays).toBe(7);
    expect(r.peakUsers).toBe(1);
  });

  it('まだ誰も来ていなければ、0のまま', () => {
    const r = retentionOf(rows([0, 0, 0, 0, 0, 0, 0]));
    expect(r).toEqual({ activeDays: 0, daysWithUse: 0, peakUsers: 0, aliveNow: false });
  });

  it('記録がまったく無くても落ちない', () => {
    expect(retentionOf([]).aliveNow).toBe(false);
  });

  /**
   * **1.0 に近いなら、来た人がその日だけで去っている。**
   * 20人が初日だけ触ったのと、3人が1週間続けたのを、見分けるための数。
   */
  it('その日だけの人と、続けた人を見分けられる', () => {
    const oneOff = retentionOf(rows([0, 0, 0, 0, 0, 0, 20]));
    const sticky = retentionOf(rows([3, 3, 3, 3, 3, 3, 3]));

    expect(oneOff.activeDays / oneOff.peakUsers).toBeCloseTo(1.0);
    expect(sticky.activeDays / sticky.peakUsers).toBeCloseTo(7.0);
  });
});
