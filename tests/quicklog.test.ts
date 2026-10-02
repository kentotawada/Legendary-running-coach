import { describe, expect, it } from 'vitest';
import {
  MAX_CHOICES,
  SESSION_KINDS,
  clock,
  dayChoices,
  distanceChoices,
  guessPaceSec,
  guessSeconds,
  paceOf,
  toWorkout,
} from '@/lib/quicklog';
import { importWorkouts } from '@/lib/workout';
import { createDefaultProfile } from '@/lib/types';
import type { ActivityLog, RunnerProfile } from '@/lib/types';

/**
 * 走ったことを、数タップで入れる。
 *
 * ここで守りたいのは2つ。
 *  1. **その人が実際に走る距離を出す。** 5kmの人に20kmの札を見せない
 *  2. **時間を、普段のペースから先に埋める。** ゼロから打たせない
 */

const NOW = new Date('2026-10-02T20:00:00+09:00');

function dateDaysAgo(days: number): string {
  const d = new Date('2026-10-02T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function run(daysAgo: number, km: number, minutes: number): ActivityLog {
  const date = dateDaysAgo(daysAgo);
  return {
    id: `a${daysAgo}-${km}`,
    date,
    type: 'run',
    distanceKm: km,
    durationMin: minutes,
    createdAt: `${date}T10:00:00.000Z`,
  };
}

const profileOf = (activities: ActivityLog[], extra: Partial<RunnerProfile> = {}): RunnerProfile => ({
  ...createDefaultProfile('u1', '2026-06-01T00:00:00.000Z'),
  activities,
  ...extra,
});

describe('距離の札', () => {
  it('記録が無い人には、短いところから出す（初日に20kmを見せない）', () => {
    const choices = distanceChoices(profileOf([]), undefined, NOW);
    expect(choices.length).toBeGreaterThan(0);
    expect(Math.max(...choices)).toBeLessThanOrEqual(10);
  });

  it('その人がよく走る距離を出す', () => {
    const profile = profileOf([
      run(2, 5, 28),
      run(4, 5, 29),
      run(6, 5.2, 29),
      run(9, 6, 34),
    ]);
    const choices = distanceChoices(profile, undefined, NOW);
    expect(choices).toContain(5);
    // 5kmしか走らない人に、20kmの札は出さない。
    expect(choices.every((km) => km <= 10)).toBe(true);
  });

  it('今日の予定の距離を必ず含める', () => {
    const profile = profileOf([run(2, 5, 28), run(4, 5, 29)]);
    expect(distanceChoices(profile, 16, NOW)).toContain(16);
  });

  it('近すぎる札は並べない（0.5km以内は同じ札として扱う）', () => {
    const profile = profileOf([run(2, 10, 55), run(3, 10.2, 56), run(4, 10.4, 57)]);
    const choices = distanceChoices(profile, 10.1, NOW);
    const tens = choices.filter((km) => Math.abs(km - 10) < 0.5);
    expect(tens.length).toBe(1);
  });

  it('札は多すぎない（選ぶより打つほうが速くならない数に抑える）', () => {
    const profile = profileOf(
      Array.from({ length: 20 }, (_, index) => run(index + 1, index + 2, (index + 2) * 6)),
    );
    expect(distanceChoices(profile, undefined, NOW).length).toBeLessThanOrEqual(MAX_CHOICES);
  });

  it('短い順に並べる', () => {
    const profile = profileOf([run(2, 16, 92), run(3, 5, 28), run(4, 10, 55), run(5, 10, 56)]);
    const choices = distanceChoices(profile, undefined, NOW);
    expect([...choices].sort((a, b) => a - b)).toEqual(choices);
  });
});

describe('時間の見積もり', () => {
  it('似た距離の直近のペースを使う', () => {
    // 10kmを55分（5:30/km）で走っている人。
    const profile = profileOf([run(3, 10, 55), run(7, 10, 55), run(11, 10.2, 56)]);
    const seconds = guessSeconds(profile, 10, NOW);
    expect(seconds).toBeDefined();
    // 55分 = 3300秒。多少の幅は許す。
    expect(Math.abs((seconds ?? 0) - 3300)).toBeLessThan(120);
  });

  it('5kmのペースで30kmの時間を見積もらない（距離で調整する）', () => {
    // 5kmを25分（5:00/km）だけ走っている人に、30kmを聞く。
    const profile = profileOf([run(3, 5, 25), run(6, 5, 25), run(9, 5, 25)]);
    const pace = guessPaceSec(profile, 30, NOW);
    expect(pace).toBeDefined();
    // 5:00/km そのままでは出さない。長い距離は遅くなる。
    expect(pace!).toBeGreaterThan(300);
  });

  it('記録が無い人には、目標から置く', () => {
    const profile = profileOf([], { goal: { kind: 'time', summary: 'サブ3.5', targetTime: '3:30:00' } });
    const pace = guessPaceSec(profile, 10, NOW);
    expect(pace).toBeDefined();
    // マラソンのペース（約4:59/km）より遅く置く。練習は目標より遅い。
    expect(pace!).toBeGreaterThan(299);
  });

  it('記録も目標も無ければ、何も出さない（当てずっぽうを埋めない）', () => {
    expect(guessSeconds(profileOf([]), 10, NOW)).toBeUndefined();
  });

  it('あり得ないペースの記録は使わない', () => {
    // 10kmを5分（30秒/km）は読み違え。これを平均に入れない。
    const profile = profileOf([run(3, 10, 5), run(5, 10, 55), run(7, 10, 55)]);
    const pace = guessPaceSec(profile, 10, NOW);
    expect(pace).toBeDefined();
    expect(pace!).toBeGreaterThan(300);
  });

  it('古すぎる記録は使わない', () => {
    const profile = profileOf([run(200, 10, 40), run(210, 10, 40)]);
    expect(guessSeconds(profile, 10, NOW)).toBeUndefined();
  });
});

describe('時間の表示', () => {
  it('1時間未満は 分:秒', () => {
    expect(clock(52 * 60 + 30)).toBe('52:30');
  });

  it('1時間以上は 時:分:秒', () => {
    expect(clock(3600 + 52 * 60 + 30)).toBe('1:52:30');
  });

  it('秒は2桁に揃える', () => {
    expect(clock(52 * 60 + 5)).toBe('52:05');
  });
});

describe('ペースの計算', () => {
  it('距離と時間から1kmあたりを出す', () => {
    expect(paceOf(10, 55 * 60)).toBe('5:30/km');
  });

  it('あり得ない値は出さない', () => {
    expect(paceOf(10, 60)).toBeUndefined();
    expect(paceOf(0, 3300)).toBeUndefined();
  });
});

describe('日付の札', () => {
  it('今日・昨日・おとといを出す', () => {
    const days = dayChoices(NOW);
    expect(days.map((day) => day.label)).toEqual(['今日', '昨日', 'おととい']);
  });

  it('1日ずつさかのぼる', () => {
    const days = dayChoices(NOW);
    expect(days[0].date > days[1].date).toBe(true);
    expect(days[1].date > days[2].date).toBe(true);
  });
});

describe('送る形に組み立てる', () => {
  it('距離をメートルに、時間を秒にして渡す', () => {
    const workout = toWorkout({ date: '2026-10-02', km: 10.2, seconds: 3300, now: NOW });
    expect(workout?.distanceM).toBe(10_200);
    expect(workout?.durationSec).toBe(3300);
    expect(workout?.source).toBe('self-report');
  });

  it('時刻はその日の正午に置く（日付の境目から離す）', () => {
    expect(toWorkout({ date: '2026-10-02', km: 10, now: NOW })?.startedAt).toBe(
      '2026-10-02T12:00:00',
    );
  });

  it('時間が無くても組み立てる（距離だけでも週の量になる）', () => {
    const workout = toWorkout({ date: '2026-10-02', km: 8, now: NOW });
    expect(workout).not.toBeNull();
    expect(workout?.durationSec).toBeUndefined();
  });

  it('ウォークは walk として入れる', () => {
    expect(toWorkout({ date: '2026-10-02', km: 3, kind: 'walk', now: NOW })?.type).toBe('walk');
  });

  it('種類を選べば、その呼び名を付ける', () => {
    expect(toWorkout({ date: '2026-10-02', km: 25, kind: 'long', now: NOW })?.name).toBe('ロング走');
  });

  it('種類を選ばなくても組み立てる', () => {
    expect(toWorkout({ date: '2026-10-02', km: 8, now: NOW })?.name).toBeUndefined();
  });

  it('距離が無ければ組み立てない', () => {
    expect(toWorkout({ date: '2026-10-02', km: 0, now: NOW })).toBeNull();
  });

  it('日付の形が違えば組み立てない', () => {
    expect(toWorkout({ date: '2026/10/02', km: 8, now: NOW })).toBeNull();
  });

  it('同じ日の2本目が1本目を上書きしない（2部練習）', () => {
    const first = toWorkout({ date: '2026-10-02', km: 10, now: NOW });
    const second = toWorkout({ date: '2026-10-02', km: 8, now: NOW });
    expect(first?.externalId).not.toBe(second?.externalId);
  });
});

describe('練習の種類', () => {
  it('どれも呼び名を持っている', () => {
    for (const kind of SESSION_KINDS) {
      expect(kind.label.length).toBeGreaterThan(0);
      expect(kind.session.length).toBeGreaterThan(0);
    }
  });

  it('画面に出す文字に ** が残っていない', () => {
    for (const kind of SESSION_KINDS) {
      expect(kind.label).not.toContain('**');
      expect(kind.session).not.toContain('**');
    }
  });
});

/**
 * 取り込みの入口を、そのまま使う。
 *
 * **手で入れたものが、あとから来た本物に負けること**がここの肝。
 * 時計をあとでつないだ時に、手入力が居座って区間も心拍も入らない、
 * というのがいちばん困る。
 */
describe('取り込みの入口を通す', () => {
  const base = () => createDefaultProfile('u1', NOW.toISOString());

  it('手で入れた1本が、そのままカルテに入る', () => {
    const workout = toWorkout({ date: '2026-09-22', km: 10, seconds: 3300, now: NOW })!;
    const result = importWorkouts(base(), [workout], NOW);

    expect(result.imported).toBe(1);
    expect(result.profile.activities[0]).toMatchObject({
      date: '2026-09-22',
      distanceKm: 10,
      durationMin: 55,
      source: 'self-report',
    });
  });

  it('同じ練習を二度押しても、二重には入らない', () => {
    const once = importWorkouts(
      base(),
      [toWorkout({ date: '2026-09-22', km: 10, seconds: 3300, now: NOW })!],
      NOW,
    );
    const twice = importWorkouts(
      once.profile,
      [toWorkout({ date: '2026-09-22', km: 10, seconds: 3300, now: NOW })!],
      NOW,
    );
    expect(twice.imported).toBe(0);
    expect(twice.profile.activities).toHaveLength(1);
  });

  /**
   * **ここが大事。** あとで時計をつないだ時、手入力が居座ってはいけない。
   * 区間も心拍の推移も、本物のファイルにしか入っていない。
   */
  it('あとから来たファイルが、手入力を置き換える（手応えは残る）', () => {
    const manual = importWorkouts(
      base(),
      [toWorkout({ date: '2026-09-22', km: 10, seconds: 3300, now: NOW })!],
      NOW,
    );
    // 走った直後に押した手応えを入れておく。
    const withEffort = {
      ...manual.profile,
      activities: manual.profile.activities.map((activity) => ({ ...activity, effort: 5 })),
    };

    const richer = importWorkouts(
      withEffort,
      [
        {
          externalId: 'file:real',
          startedAt: '2026-09-22T09:00:00Z',
          type: 'run' as const,
          distanceM: 10_050,
          durationSec: 3310,
          avgHr: 148,
          source: 'file' as const,
          laps: [
            { distanceM: 1000, durationSec: 331 },
            { distanceM: 1000, durationSec: 330 },
          ],
        },
      ],
      NOW,
    );

    expect(richer.upgraded).toBe(1);
    expect(richer.profile.activities).toHaveLength(1);
    const merged = richer.profile.activities[0];
    expect(merged.source).toBe('file');
    expect(merged.metrics?.avgHr).toBe(148);
    // **押した手応えは、置き換えでも消さない。** 時計には無いものなので。
    expect(merged.effort).toBe(5);
  });
});
