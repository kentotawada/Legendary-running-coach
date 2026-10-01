import { describe, expect, it } from 'vitest';
import { buildMonth, dateKey, intensityOf, monthRange, shiftMonth, WEEKDAYS } from '@/lib/calendar';
import { createDefaultProfile } from '@/lib/types';
import type { ActivityLog, RunnerProfile } from '@/lib/types';

/**
 * ひと月を1枚の表で見る。
 *
 * グラフは「どれだけ積んだか」を見せるが、**「どれだけ空いたか」は見せない。**
 * 枡を並べて初めて、空白が空白として目に入る。
 */

const NOW = new Date('2026-09-15T12:00:00+09:00');

function activity(date: string, distanceKm: number, durationMin: number): ActivityLog {
  return {
    id: date,
    date,
    type: 'run',
    distanceKm,
    durationMin,
    createdAt: `${date}T12:00:00.000Z`,
  };
}

function profileWith(activities: ActivityLog[], extra: Partial<RunnerProfile> = {}): RunnerProfile {
  return { ...createDefaultProfile('test'), activities, bodyWeightKg: 60, ...extra };
}

describe('ひと月のカレンダー', () => {
  it('週の始まりは月曜（review.ts の週の区切りと揃える）', () => {
    expect(WEEKDAYS[0]).toBe('月');
    expect(WEEKDAYS[6]).toBe('日');
  });

  it('常に6週 × 7日そろっている（月によって形が変わらない）', () => {
    for (const month of [1, 2, 6, 9, 12]) {
      const built = buildMonth(profileWith([]), 2026, month, NOW);
      expect(built.weeks, `${month}月`).toHaveLength(6);
      for (const week of built.weeks) expect(week).toHaveLength(7);
    }
  });

  it('1日は、その週の月曜から数えた位置に入る', () => {
    // 2026-09-01 は火曜。月曜始まりなら、1週目の2番目。
    const built = buildMonth(profileWith([]), 2026, 9, NOW);
    const first = built.weeks[0]!;
    expect(first[0]!.inMonth).toBe(false); // 8/31（月）
    expect(first[1]!.date).toBe('2026-09-01');
    expect(first[1]!.inMonth).toBe(true);
  });

  it('前後の月から埋めた枡は、その月の合計に入らない', () => {
    const built = buildMonth(
      profileWith([activity('2026-08-31', 10, 50), activity('2026-09-01', 5, 25)]),
      2026,
      9,
      NOW,
    );
    expect(built.km).toBe(5);
    expect(built.activeDays).toBe(1);
    // 枡そのものには出す（その日に走ったのは事実なので）。
    expect(built.weeks[0]![0]!.km).toBe(10);
    expect(built.weeks[0]![0]!.inMonth).toBe(false);
  });

  it('同じ日に2本走ったら、足して1つの枡にする', () => {
    const built = buildMonth(
      profileWith([activity('2026-09-03', 10, 50), activity('2026-09-03', 5, 25)]),
      2026,
      9,
      NOW,
    );
    const day = built.weeks.flat().find((d) => d.date === '2026-09-03')!;
    expect(day.km).toBe(15);
    expect(day.minutes).toBe(75);
    expect(day.types).toEqual(['run', 'run']);
    expect(built.activeDays).toBe(1); // 日数は1日
  });

  it('カロリーの目安も、その日ぶんと月ぶんを出す', () => {
    const built = buildMonth(profileWith([activity('2026-09-03', 10, 50)]), 2026, 9, NOW);
    const day = built.weeks.flat().find((d) => d.date === '2026-09-03')!;
    expect(day.kcal).not.toBeNull();
    expect(built.kcal).toBe(day.kcal);
  });

  it('体重が分からなければ、カロリーは出さない（0 にしない）', () => {
    const built = buildMonth(
      profileWith([activity('2026-09-03', 10, 50)], { bodyWeightKg: undefined }),
      2026,
      9,
      NOW,
    );
    expect(built.kcal).toBeNull();
    expect(built.weeks.flat().find((d) => d.date === '2026-09-03')!.kcal).toBeNull();
    // 距離は出る。カロリーだけが出ないこと。
    expect(built.km).toBe(10);
  });

  it('今日と、まだ来ていない日を分ける', () => {
    const built = buildMonth(profileWith([]), 2026, 9, NOW);
    const days = built.weeks.flat();
    expect(days.find((d) => d.date === '2026-09-15')!.isToday).toBe(true);
    expect(days.find((d) => d.date === '2026-09-14')!.isFuture).toBe(false);
    expect(days.find((d) => d.date === '2026-09-16')!.isFuture).toBe(true);
  });

  /**
   * **走れなかった日の理由が見えることが大事。**
   * 空白だけが並んでいると「サボった」に見えるが、
   * 痛くて止めた日は、止めたほうが正しかった日。
   */
  it('痛みを抱えていた日に印が付く', () => {
    const built = buildMonth(
      profileWith([], {
        pains: [
          {
            site: '右ひざ',
            status: 'active',
            since: '2026-09-10',
            updatedAt: '2026-09-10T00:00:00.000Z',
          },
        ],
      } as Partial<RunnerProfile>),
      2026,
      9,
      NOW,
    );
    const days = built.weeks.flat();
    expect(days.find((d) => d.date === '2026-09-09')!.pain).toBe(false);
    expect(days.find((d) => d.date === '2026-09-10')!.pain).toBe(true);
    expect(days.find((d) => d.date === '2026-09-15')!.pain).toBe(true);
  });

  it('治った痛みは、治った日までで止まる', () => {
    const built = buildMonth(
      profileWith([], {
        pains: [
          {
            site: '右ひざ',
            status: 'resolved',
            since: '2026-09-02',
            updatedAt: '2026-09-04T00:00:00.000Z',
          },
        ],
      } as Partial<RunnerProfile>),
      2026,
      9,
      NOW,
    );
    const days = built.weeks.flat();
    expect(days.find((d) => d.date === '2026-09-04')!.pain).toBe(true);
    expect(days.find((d) => d.date === '2026-09-05')!.pain).toBe(false);
  });

  it('はかった体重が、その日の枡に乗る', () => {
    const built = buildMonth(
      profileWith([], { dailyLog: [{ date: '2026-09-08', opened: true, weightKg: 58.2 }] }),
      2026,
      9,
      NOW,
    );
    expect(built.weeks.flat().find((d) => d.date === '2026-09-08')!.weightKg).toBe(58.2);
  });

  it('記録が無くても落ちない', () => {
    const built = buildMonth(null, 2026, 9, NOW);
    expect(built.weeks).toHaveLength(6);
    expect(built.km).toBe(0);
    expect(built.kcal).toBeNull();
    expect(built.activeDays).toBe(0);
  });
});

describe('めくれる範囲', () => {
  it('記録のある最初の月から、今月まで', () => {
    const range = monthRange(
      profileWith([activity('2026-03-11', 5, 30), activity('2026-09-01', 5, 30)]),
      NOW,
    );
    expect(range.first).toEqual({ year: 2026, month: 3 });
    expect(range.last).toEqual({ year: 2026, month: 9 });
  });

  it('記録が無ければ、今月だけ', () => {
    const range = monthRange(profileWith([]), NOW);
    expect(range.first).toEqual(range.last);
    expect(range.last).toEqual({ year: 2026, month: 9 });
  });

  it('未来の日付の記録があっても、今月より先には行かせない', () => {
    const range = monthRange(profileWith([activity('2027-01-05', 5, 30)]), NOW);
    expect(range.last).toEqual({ year: 2026, month: 9 });
    expect(range.first).toEqual({ year: 2026, month: 9 });
  });
});

describe('月をめくる', () => {
  it('年をまたぐ', () => {
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });

  it('何か月でも動かせる', () => {
    expect(shiftMonth(2026, 9, -12)).toEqual({ year: 2025, month: 9 });
    expect(shiftMonth(2026, 9, 5)).toEqual({ year: 2027, month: 2 });
  });
});

describe('枡の濃さ', () => {
  const day = (km: number) => ({ km }) as never;

  it('走っていない日は 0', () => {
    expect(intensityOf(day(0), 20)).toBe(0);
  });

  it('いちばん長い日が 1', () => {
    expect(intensityOf(day(20), 20)).toBe(1);
  });

  it('短い日も見えるように、下限がある', () => {
    // 20km の月に 1km 走った日。0.05 では、ほぼ何も見えない。
    expect(intensityOf(day(1), 20)).toBeGreaterThanOrEqual(0.25);
  });

  it('基準が無くても落ちない', () => {
    expect(intensityOf(day(5), 0)).toBe(1);
  });
});

describe('dateKey', () => {
  it('ゼロ埋めする', () => {
    expect(dateKey(2026, 1, 5)).toBe('2026-01-05');
    expect(dateKey(2026, 12, 31)).toBe('2026-12-31');
  });
});
