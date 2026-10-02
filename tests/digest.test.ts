import { describe, expect, it } from 'vitest';
import { digestDoctrine, digestLine, weeklyDigest } from '@/lib/digest';
import { createDefaultProfile } from '@/lib/types';
import type { ActivityLog, RunnerProfile } from '@/lib/types';

/**
 * この7日のふりかえり。
 *
 * **「よく頑張りました」を言わない。** 数字を見せれば、本人が判断できる。
 * 頑張りの評価を外から渡すと、少ない週にこの画面を開けなくなる。
 */

const NOW = new Date('2026-10-02T20:00:00+09:00');

function dateDaysAgo(days: number): string {
  const d = new Date('2026-10-02T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function run(daysAgo: number, km: number, minutes: number, session?: string): ActivityLog {
  const date = dateDaysAgo(daysAgo);
  return {
    id: `a${daysAgo}-${km}`,
    date,
    type: 'run',
    session,
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

describe('語れる記録があるか', () => {
  /** **0kmと書かれた画面を見せても、走れなかった理由は変わらない。** */
  it('1本も走っていない週には、数字の話をしない', () => {
    expect(weeklyDigest(profileOf([]), NOW)).toBeNull();
    expect(weeklyDigest(profileOf([run(10, 8, 44)]), NOW)).toBeNull();
  });
});

describe('この7日', () => {
  const week = () => [run(1, 8, 44), run(3, 12, 66), run(5, 8, 44)];

  it('距離・本数・日数・時間を数える', () => {
    const digest = weeklyDigest(profileOf(week()), NOW)!;

    expect(digest.km).toBe(28);
    expect(digest.runs).toBe(3);
    expect(digest.days).toBe(3);
    expect(digest.minutes).toBe(154);
  });

  it('7日より前は、前の7日として分ける', () => {
    const digest = weeklyDigest(profileOf([...week(), run(8, 10, 55), run(12, 10, 55)]), NOW)!;

    expect(digest.km).toBe(28);
    expect(digest.prevKm).toBe(20);
    expect(digest.deltaKm).toBe(8);
  });

  it('いちばん長い1本を出す', () => {
    const digest = weeklyDigest(profileOf(week()), NOW)!;
    expect(digest.longest).toMatchObject({ km: 12, date: dateDaysAgo(3) });
    expect(digest.longest!.pace).toBe('5:30/km');
  });

  /** **減った週を責めない。** 減らすのが正しい週もある。 */
  it('減った週にも、責める言葉を置かない', () => {
    const digest = weeklyDigest(profileOf([run(1, 5, 28), run(9, 20, 110), run(11, 20, 110)]), NOW)!;

    expect(digest.deltaKm).toBeLessThan(0);
    expect(digest.detail).toContain('減らすのが正しい週もあります');
    expect(digest.detail).not.toContain('頑張');
  });

  it('比べる相手が無い週は、比べない', () => {
    const digest = weeklyDigest(profileOf(week()), NOW)!;
    expect(digest.detail).toContain('比べるのは次からです');
  });

  it('その7日に出た痛みを拾う', () => {
    const digest = weeklyDigest(
      profileOf(week(), {
        pains: [
          {
            id: 'p1',
            site: '右膝',
            severity: 2,
            status: 'active',
            since: dateDaysAgo(2),
            updatedAt: `${dateDaysAgo(2)}T10:00:00.000Z`,
          },
        ],
      }),
      NOW,
    )!;
    expect(digest.pains).toEqual(['右膝']);
  });

  it('手応えを押した本数を数える', () => {
    const rated = week().map((item, index) => (index === 0 ? { ...item, effort: 5 } : item));
    expect(weeklyDigest(profileOf(rated), NOW)!.rated).toBe(1);
  });

  /** 画面に地の文として出す。記号も、評価の言葉も混ぜない。 */
  it('記号も、頑張りの評価も混ぜない', () => {
    const digest = weeklyDigest(profileOf(week()), NOW)!;
    const all = `${digest.headline}${digest.detail}`;
    expect(all).not.toContain('**');
    expect(all).not.toMatch(/頑張|えらい|素晴らし/);
  });
});

describe('通知に出す一言', () => {
  it('帯に収まる長さにする', () => {
    const line = digestLine(weeklyDigest(profileOf([run(1, 8, 44), run(3, 12, 66)]), NOW)!);
    expect(line).toContain('20km');
    expect(line.length).toBeLessThan(40);
  });
});

describe('プロンプトに差し込むふりかえり', () => {
  it('同じことを聞かせない', () => {
    const text = digestDoctrine(profileOf([run(1, 8, 44)]), NOW)!;

    expect(text).toContain('自分で足し直さないこと');
    expect(text).toContain('「今週は何km走りましたか」と聞かないこと');
    expect(text).toContain('減った週を責めないこと');
    // **量を褒めると、翌週に無理をする。**
    expect(text).toContain('量ではなく');
  });

  it('記録が無ければ、何も載せない', () => {
    expect(digestDoctrine(profileOf([]), NOW)).toBeNull();
  });
});
