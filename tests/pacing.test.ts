import { describe, expect, it } from 'vitest';
import { PACING_FROM_DAYS, pacePlan, pacingDoctrine } from '@/lib/pacing';
import { createDefaultProfile } from '@/lib/types';
import type { RunnerProfile } from '@/lib/types';

/**
 * 大会当日の通過タイム。
 *
 * **「前半を抑えて」は助言ではない。** 抑えるのは誰でも分かっている。
 * 分からないのは「最初の5kmを何分何秒で入るのか」。
 *
 * 守るのは、無いものから表を作らないことと、暑い日に目標を勝手に下げないこと。
 */

const NOW = new Date('2026-10-02T07:00:00+09:00');

function dateInDays(days: number): string {
  const d = new Date('2026-10-02T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function withRace(
  daysOut: number,
  race: Partial<RunnerProfile['races'] extends (infer R)[] | undefined ? R : never> = {},
  extra: Partial<RunnerProfile> = {},
): RunnerProfile {
  return {
    ...createDefaultProfile('u1', '2026-06-01T00:00:00.000Z'),
    goal: { kind: 'time', summary: 'サブ3.5', targetTime: '3:30:00' },
    races: [
      {
        id: 'r1',
        name: '湘南国際マラソン',
        date: dateInDays(daysOut),
        distance: 'フル',
        priority: 'A' as const,
        ...race,
      },
    ],
    ...extra,
  };
}

describe('いつ出すか', () => {
  /** **当日に初めて見るのでは、練習で試せない。** */
  it('2週間前から出す', () => {
    expect(PACING_FROM_DAYS).toBe(14);
    expect(pacePlan(withRace(14), NOW)).not.toBeNull();
    expect(pacePlan(withRace(15), NOW)).toBeNull();
    expect(pacePlan(withRace(0), NOW)).not.toBeNull();
  });

  /** **無いものから表を作らない。** */
  it('目標タイムが無ければ出さない', () => {
    const noTarget = withRace(3, {}, { goal: undefined });
    expect(pacePlan(noTarget, NOW)).toBeNull();
  });

  it('距離が読めなければ出さない', () => {
    expect(pacePlan(withRace(3, { distance: 'よくわからない', name: 'ふれあい大会' }), NOW)).toBeNull();
  });

  it('大会が無ければ出さない', () => {
    expect(pacePlan(createDefaultProfile('u1'), NOW)).toBeNull();
  });

  it('大会ごとの目標が、全体の目標より優先される', () => {
    const plan = pacePlan(withRace(3, { targetTime: '3:15:00' }), NOW)!;
    expect(plan.targetTime).toBe('3:15:00');
  });
});

describe('通過タイム', () => {
  /** **市民ランナーの失敗は、ほぼ全部が突っ込みすぎ。** */
  it('入りは目標より遅く、終盤は速く置く', () => {
    const plan = pacePlan(withRace(3), NOW)!;
    const opening = plan.splits.find((split) => split.phase === '入り')!;
    const closing = plan.splits[plan.splits.length - 1];

    expect(opening.pace > closing.pace).toBe(true); // 文字列比較でも、遅いほうが大きい
    expect(plan.splits[0].phase).toBe('入り');
    expect(closing.phase).toBe('終盤');
  });

  /**
   * **目標3:30:00の表の最後が 3:30:43 だったら、見た人は数字を信じない。**
   * 配分の形は保ったまま、合計はちょうどに合わせる。
   */
  it('最後の通過が、目標タイムちょうどになる', () => {
    const plan = pacePlan(withRace(3), NOW)!;
    const last = plan.splits[plan.splits.length - 1];
    const [h, m, s] = last.elapsed.split(':').map(Number);
    const seconds = h * 3600 + m * 60 + s;

    // 3:30:00 = 12600秒。表示の丸めぶん（1秒）しかずれない。
    expect(Math.abs(seconds - 12600)).toBeLessThanOrEqual(1);
  });

  it('距離が変わっても、合計は目標ちょうど', () => {
    for (const [distance, name, target, want] of [
      ['ハーフ', 'ハーフマラソン', '1:40:00', 6000],
      ['10km', '秋の10kmレース', '0:45:00', 2700],
    ] as const) {
      const plan = pacePlan(withRace(3, { distance, name, targetTime: target }), NOW)!;
      const last = plan.splits[plan.splits.length - 1].elapsed.split(':').map(Number);
      const seconds =
        last.length === 3 ? last[0] * 3600 + last[1] * 60 + last[2] : last[0] * 60 + last[1];
      expect(Math.abs(seconds - want)).toBeLessThanOrEqual(1);
    }
  });

  it('フルは5kmごと、10kmは2kmごとに刻む', () => {
    const full = pacePlan(withRace(3), NOW)!;
    expect(full.splits[0].km).toBe(5);
    // 画面に出すのは 42.2km。小数3桁は、走っている人には要らない。
    expect(full.splits[full.splits.length - 1].km).toBe(42.2);

    const ten = pacePlan(withRace(3, { distance: '10km', name: '秋の10kmレース' }), NOW)!;
    expect(ten.splits[0].km).toBe(2);
    expect(ten.splits[ten.splits.length - 1].km).toBe(10);
  });

  it('ハーフを、フルと取り違えない', () => {
    const half = pacePlan(withRace(3, { distance: 'ハーフ', name: 'ハーフマラソン' }), NOW)!;
    expect(half.distanceKm).toBeCloseTo(21.0975, 3);
  });

  it('抑える理由を、言葉で添える', () => {
    const plan = pacePlan(withRace(3), NOW)!;
    expect(plan.note).toContain('抑えて入ったぶんは、後半に返ってきます');
    expect(plan.note).not.toContain('**');
  });
});

describe('崩れたとき', () => {
  /** **崩れてから考えると、たいてい歩く。** 先に決めておく。 */
  it('決めごとを先に置く', () => {
    const plan = pacePlan(withRace(3), NOW)!;
    const all = plan.ifItBreaks.map((item) => `${item.when}${item.what}`).join('');

    expect(all).toContain('完走に切り替える');
    expect(all).toContain('前半で');
    expect(all).toContain('つり');
  });

  /** 体の危険だけは、記録と比べない。 */
  it('危ない兆候は、記録より先に置く', () => {
    const plan = pacePlan(withRace(3), NOW)!;
    const danger = plan.ifItBreaks.find((item) => item.when.includes('胸が痛い'))!;
    expect(danger.what).toContain('すぐにやめて');
    expect(danger.what).toContain('記録とは比べません');
  });
});

describe('暑い日', () => {
  const hot = (temperatureC: number, humidity: number) =>
    withRace(1, {}, { weather: { temperatureC, humidity, at: NOW.toISOString() } });

  /** **目標は書き換えない。** 下げるかどうかを決めるのは本人。 */
  it('目標はそのまま残して、見込みだけ足す', () => {
    const plan = pacePlan(hot(26, 75), NOW)!;

    expect(plan.targetTime).toBe('3:30:00');
    expect(plan.heat).toBeTruthy();
    expect(plan.heat!.adjustedTime).not.toBe('3:30:00');
    // 通過タイムの表は、目標のままで刻む。
    expect(plan.splits[0].elapsed).toBe(pacePlan(withRace(1), NOW)!.splits[0].elapsed);
  });

  it('涼しい日は、何も足さない', () => {
    expect(pacePlan(hot(10, 50), NOW)!.heat).toBeUndefined();
  });

  it('古い読みでは、暑いと言わない', () => {
    const stale = withRace(1, {}, {
      weather: {
        temperatureC: 30,
        humidity: 80,
        at: new Date(NOW.getTime() - 6 * 3_600_000).toISOString(),
      },
    });
    expect(pacePlan(stale, NOW)!.heat).toBeUndefined();
  });
});

describe('プロンプトに差し込む配分', () => {
  it('画面に出ている数字を、そのまま知らせる', () => {
    const text = pacingDoctrine(withRace(3), NOW)!;

    expect(text).toContain('本人はもう見ている');
    expect(text).toContain('湘南国際マラソン');
    expect(text).toContain('「前半を抑えて」だけで終わらせないこと');
  });

  it('暑い日は、目標を書き換えさせない', () => {
    const text = pacingDoctrine(
      withRace(1, {}, { weather: { temperatureC: 27, humidity: 80, at: NOW.toISOString() } }),
      NOW,
    )!;
    expect(text).toContain('本人の目標は書き換えないこと');
  });

  it('大会が遠ければ、何も載せない', () => {
    expect(pacingDoctrine(withRace(30), NOW)).toBeNull();
  });
});
