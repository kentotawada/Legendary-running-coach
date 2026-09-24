import { describe, expect, it } from 'vitest';
import {
  fourWeekComparison,
  monthlyVolume,
  paceLabel,
  paceTrend,
  painHistory,
  weeklyPace,
  totals,
  weightTrend,
} from '@/lib/review';
import { addActivity, applyProfileUpdate, upsertPain } from '@/lib/profile';
import { logWeight } from '@/lib/daily';
import { createDefaultProfile } from '@/lib/types';
import type { ActivityLog, RunnerProfile } from '@/lib/types';

const NOW = new Date('2026-09-24T09:00:00Z');
const base = () => createDefaultProfile('u1', NOW.toISOString());

function run(
  profile: RunnerProfile,
  date: string,
  distanceKm: number,
  extra: Partial<ActivityLog> = {},
): RunnerProfile {
  return addActivity(profile, { date, type: 'run', distanceKm, ...extra }, NOW);
}

describe('月ごとの走行距離', () => {
  it('記録の無い月も0として並べる（途切れも情報なので）', () => {
    let profile = base();
    profile = run(profile, '2026-09-10', 12);
    profile = run(profile, '2026-09-20', 18.4);
    profile = run(profile, '2026-07-05', 10);

    const months = monthlyVolume(profile, 6, NOW);

    expect(months).toHaveLength(6);
    expect(months.at(-1)).toMatchObject({ month: '2026-09', label: '9月', km: 30, runs: 2 });
    expect(months.find((m) => m.month === '2026-08')).toMatchObject({ km: 0, runs: 0 });
    expect(months.find((m) => m.month === '2026-07')?.km).toBe(10);
  });

  it('範囲の外の記録は混ぜない', () => {
    const profile = run(base(), '2025-01-05', 100);
    expect(monthlyVolume(profile, 6, NOW).every((month) => month.km === 0)).toBe(true);
  });
});

describe('積み上げの総量', () => {
  it('最初の記録の日からの日数と、距離・時間を出す', () => {
    let profile = run(base(), '2026-08-25', 10, { durationMin: 50 });
    profile = run(profile, '2026-09-20', 21.1, { durationMin: 100 });
    profile = addActivity(profile, { date: '2026-09-21', type: 'strength', durationMin: 30 }, NOW);

    const summary = totals(profile, NOW);

    expect(summary.since).toBe('2026-08-25');
    expect(summary.days).toBe(30);
    expect(summary.runs).toBe(2);
    expect(summary.km).toBe(31);
    expect(summary.hours).toBe(3);
    // 10時間を超えたら小数は出さない（桁が増えるほど読みにくい）
    expect(summary.loggedDays).toBe(3);
  });

  it('長く積み上がったら、時間は整数で出す', () => {
    let profile = base();
    for (let index = 0; index < 20; index += 1) {
      profile = run(profile, `2026-09-${String((index % 28) + 1).padStart(2, '0')}`, 10, { durationMin: 55 });
    }
    expect(totals(profile, NOW).hours).toBe(18);
  });

  it('記録が無ければ、0で返す（画面側が空の案内を出せるように）', () => {
    expect(totals(base(), NOW)).toMatchObject({ runs: 0, km: 0, loggedDays: 0 });
  });
});

describe('ペースの移り変わり', () => {
  it('短い練習は混ぜない（流しで線が暴れる）', () => {
    let profile = run(base(), '2026-09-10', 12, { metrics: { avgPace: '5:00/km' } });
    profile = run(profile, '2026-09-11', 2, { metrics: { avgPace: '3:30/km' } });

    const points = paceTrend(profile, { now: NOW });
    expect(points).toHaveLength(1);
    expect(points[0].secondsPerKm).toBe(300);
  });

  it('ペースの記録が無くても、距離と時間から出す', () => {
    const profile = run(base(), '2026-09-10', 10, { durationMin: 50 });
    expect(paceTrend(profile, { now: NOW })[0].secondsPerKm).toBe(300);
  });

  it('ありえない値は捨てる（読み取り誤りが線を壊す）', () => {
    const profile = run(base(), '2026-09-10', 10, { durationMin: 5 });
    expect(paceTrend(profile, { now: NOW })).toHaveLength(0);
  });

  it('古い順に並べる', () => {
    let profile = run(base(), '2026-09-20', 10, { durationMin: 50 });
    profile = run(profile, '2026-09-10', 10, { durationMin: 52 });
    expect(paceTrend(profile, { now: NOW }).map((p) => p.date)).toEqual(['2026-09-10', '2026-09-20']);
  });
});

describe('週ごとの平均ペース', () => {
  it('同じ週の練習をならす（1本ずつだと線が鋸の歯になる）', () => {
    let profile = base();
    // 2026-09-21 は月曜。同じ週に速い日と遅い日を置く。
    profile = run(profile, '2026-09-21', 10, { durationMin: 50 }); // 5:00
    profile = run(profile, '2026-09-23', 10, { durationMin: 60 }); // 6:00
    profile = run(profile, '2026-09-14', 10, { durationMin: 55 }); // 前の週

    const weeks = weeklyPace(profile, { now: NOW });

    expect(weeks).toHaveLength(2);
    expect(weeks[0]).toMatchObject({ weekStart: '2026-09-14', secondsPerKm: 330, runs: 1 });
    expect(weeks[1]).toMatchObject({ weekStart: '2026-09-21', secondsPerKm: 330, runs: 2 });
  });

  it('日曜は、その前の月曜から始まる週に入れる', () => {
    // 2026-09-20 は日曜。週の始まりは 09-14。
    const profile = run(base(), '2026-09-20', 10, { durationMin: 50 });
    expect(weeklyPace(profile, { now: NOW })[0].weekStart).toBe('2026-09-14');
  });

  it('走っていない週は、点を作らない（0に落ちない）', () => {
    let profile = run(base(), '2026-09-21', 10, { durationMin: 50 });
    profile = run(profile, '2026-08-24', 10, { durationMin: 50 });
    expect(weeklyPace(profile, { now: NOW })).toHaveLength(2);
  });
});

describe('直近4週と、その前の4週', () => {
  it('距離・ポイント練習・平均ペースを並べる', () => {
    let profile = base();
    // 直近4週
    profile = run(profile, '2026-09-20', 20, { durationMin: 100, session: '閾値走' });
    profile = run(profile, '2026-09-10', 10, { durationMin: 50 });
    // その前の4週
    profile = run(profile, '2026-08-20', 12, { durationMin: 66 });

    const [distance, sessions, pace] = fourWeekComparison(profile, NOW);

    expect(distance).toMatchObject({ recent: 30, previous: 12 });
    expect(distance.changePercent).toBe(150);
    expect(sessions).toMatchObject({ recent: 1, previous: 0 });
    // 前が0の時は割合を出さない（∞になる）
    expect(sessions.changePercent).toBeUndefined();
    expect(pace.recent).toBe(300);
    expect(pace.previous).toBe(330);
    expect(pace.higherIsBetter).toBe(false);
  });

  it('記録が無ければ0で並べる', () => {
    const rows = fourWeekComparison(base(), NOW);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.recent === 0 && row.previous === 0)).toBe(true);
  });
});

describe('体重', () => {
  it('はかった日だけを、古い順に並べる', () => {
    let profile = base();
    profile = logWeight(profile, 62.4, '2026-09-20', NOW);
    profile = logWeight(profile, 61.8, '2026-09-22', NOW);

    const points = weightTrend(profile, 90, NOW);
    expect(points).toEqual([
      { date: '2026-09-20', kg: 62.4 },
      { date: '2026-09-22', kg: 61.8 },
    ]);
  });

  it('古すぎる記録は出さない', () => {
    const profile = logWeight(base(), 62, '2026-01-01', NOW);
    expect(weightTrend(profile, 90, NOW)).toHaveLength(0);
  });
});

describe('痛みの記録', () => {
  it('続いた日数を出し、解消したものは解消として残す', () => {
    let profile = upsertPain(base(), { site: '右膝', severity: 2, since: '2026-09-10' }, NOW);
    profile = upsertPain(profile, { site: '右膝', severity: 0, status: 'resolved' }, NOW);

    const [span] = painHistory(profile, NOW);
    expect(span).toMatchObject({ site: '右膝', resolved: true, since: '2026-09-10' });
    expect(span.days).toBe(14);
  });

  it('続いているものは、今日までの日数で数える', () => {
    const profile = upsertPain(base(), { site: '左アキレス腱', severity: 2, since: '2026-09-17' }, NOW);
    expect(painHistory(profile, NOW)[0]).toMatchObject({ resolved: false, days: 7 });
  });
});

describe('表示', () => {
  it('秒/km を分と秒に直す', () => {
    expect(paceLabel(300)).toBe('5:00');
    expect(paceLabel(255.6)).toBe('4:16');
  });

  it('カルテが空でも、どの計算も落ちない', () => {
    const empty = applyProfileUpdate(base(), { displayName: 'ケント' }, NOW);
    expect(() => {
      monthlyVolume(empty, 6, NOW);
      paceTrend(empty, { now: NOW });
      weightTrend(empty, 90, NOW);
      fourWeekComparison(empty, NOW);
      painHistory(empty, NOW);
      totals(empty, NOW);
    }).not.toThrow();
  });
});
