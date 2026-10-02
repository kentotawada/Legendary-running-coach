import { describe, expect, it } from 'vitest';
import { weekDoctrine, weekPlan } from '@/lib/week';
import { createDefaultProfile } from '@/lib/types';
import type { ActivityLog, RunnerProfile } from '@/lib/types';

/**
 * この先7日の並び。
 *
 * **ここで勝手に積むと、計画の上では毎週増えていく。**
 * 守るのは、土台を本人の実績から取ること、合計を増やさないこと、
 * そして痛みがあるあいだは1日も走る予定を置かないこと。
 */

// 2026-10-02 は金曜。
const NOW = new Date('2026-10-02T07:00:00+09:00');

function dateDaysAgo(days: number): string {
  const d = new Date('2026-10-02T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function run(daysAgo: number, km: number): ActivityLog {
  const date = dateDaysAgo(daysAgo);
  return {
    id: `a${daysAgo}-${km}`,
    date,
    type: 'run',
    distanceKm: km,
    durationMin: Math.round(km * 5.5),
    createdAt: `${date}T10:00:00.000Z`,
  };
}

function profileOf(extra: Partial<RunnerProfile> = {}): RunnerProfile {
  return { ...createDefaultProfile('u1', '2026-06-01T00:00:00.000Z'), ...extra };
}

/** 直近4週を週30kmで走っている人（6日 × 5km）。 */
function steady(extra: Partial<RunnerProfile> = {}): RunnerProfile {
  const activities: ActivityLog[] = [];
  for (let day = 1; day < 35; day += 1) {
    if (day % 7 === 0) continue;
    activities.push(run(day, 5));
  }
  return profileOf({ activities, ...extra });
}

describe('7日ぶんを並べる', () => {
  it('今日から7日を、曜日つきで出す', () => {
    const plan = weekPlan(steady(), NOW);

    expect(plan.days).toHaveLength(7);
    expect(plan.days[0].date).toBe('2026-10-02');
    expect(plan.days[0].isToday).toBe(true);
    expect(plan.days[0].weekday).toBe('金');
    expect(plan.days[6].date).toBe('2026-10-08');
    expect(plan.days.filter((day) => day.isToday)).toHaveLength(1);
  });

  /** **土台は本人の実績。** 目標の表から引いた理想値を置くと、初週から2倍の計画が出る。 */
  it('土台は、いま実際に走っている量から取る', () => {
    const plan = weekPlan(steady(), NOW);
    expect(plan.baseKm).toBe(30);
  });

  /**
   * **ここで1割積むと、計画の上では毎週1割ずつ増えていく。**
   * 1日ずつ四捨五入するだけでも、5日ぶんで2〜3km ふくらむ。
   * それは誰も決めていない増量なので、合計をちょうどに合わせる。
   */
  it('合計を、土台ちょうどに合わせる', () => {
    for (const profile of [steady(), steady({ goal: { kind: 'time', summary: 'サブ3.5', targetTime: '3:30:00' } })]) {
      const plan = weekPlan(profile, NOW);
      expect(plan.totalKm).toBe(Math.round(plan.baseKm));
    }
  });

  it('週の8割をイージーに寄せ、ポイントは多くても2回まで', () => {
    const plan = weekPlan(
      steady({ goal: { kind: 'time', summary: 'サブ3.5', targetTime: '3:30:00' } }),
      NOW,
    );
    const points = plan.days.filter((day) => day.kind === 'point');
    const longs = plan.days.filter((day) => day.kind === 'long');

    expect(points.length).toBeLessThanOrEqual(2);
    expect(longs).toHaveLength(1);
    expect(plan.days.filter((day) => day.kind === 'rest').length).toBeGreaterThanOrEqual(1);
  });

  it('目標が健康維持なら、ポイントを置かない', () => {
    const plan = weekPlan(steady({ goal: { kind: 'health', summary: '健康維持' } }), NOW);
    expect(plan.days.some((day) => day.kind === 'point')).toBe(false);
  });

  it('組み立ての理由を、必ず言葉で出す', () => {
    const plan = weekPlan(steady(), NOW);
    expect(plan.note).toContain('30km');
    expect(plan.note).not.toContain('**');
  });
});

describe('痛みがあるとき', () => {
  const hurt = () =>
    steady({
      pains: [
        {
          id: 'p1',
          site: '右膝の外側',
          severity: 2,
          status: 'active',
          since: dateDaysAgo(3),
          updatedAt: `${dateDaysAgo(1)}T10:00:00.000Z`,
        },
      ],
    });

  /** **1日も走る予定を置かない。** 先の日に置くと、それが目標になってしまう。 */
  it('7日とも、走る予定を置かない', () => {
    const plan = weekPlan(hurt(), NOW);

    expect(plan.days.every((day) => day.kind === 'rest')).toBe(true);
    expect(plan.totalKm).toBe(0);
    expect(plan.note).toContain('右膝の外側');
  });
});

describe('大会が入っているとき', () => {
  const withRace = (daysOut: number) =>
    steady({
      races: [
        {
          id: 'r1',
          name: '湘南国際マラソン',
          date: dateDaysAgo(-daysOut),
          distance: 'フル',
          priority: 'A' as const,
        },
      ],
    });

  it('大会の日を中心に、前後を組み替える', () => {
    const plan = weekPlan(withRace(4), NOW);

    expect(plan.days[4].kind).toBe('race');
    expect(plan.days[4].note).toBe('湘南国際マラソン');
    expect(plan.days[3].kind).toBe('rest'); // 前日
    expect(plan.days[2].kind).toBe('easy'); // 短く + 流し
    expect(plan.days[5].kind).toBe('rest'); // 翌日
  });

  it('7日より先の大会には、何もしない', () => {
    const plan = weekPlan(withRace(20), NOW);
    expect(plan.days.some((day) => day.kind === 'race')).toBe(false);
  });
});

describe('今日もう走っている日', () => {
  it('今日の枠を「走った」に替える', () => {
    const profile = steady();
    const plan = weekPlan(
      profileOf({ activities: [...profile.activities, run(0, 8)] }),
      NOW,
    );

    expect(plan.days[0].label).toBe('走った');
    expect(plan.days[0].km).toBeUndefined();
  });
});

describe('記録がまだ無い人', () => {
  it('数字ではなく、置き方の形だけを出す', () => {
    const plan = weekPlan(profileOf(), NOW);

    expect(plan.days).toHaveLength(7);
    expect(plan.baseKm).toBe(0);
    expect(plan.totalKm).toBe(0);
    expect(plan.note).toContain('記録が貯まるほど');
  });

  it('語れる土台が無ければ、プロンプトには載せない', () => {
    expect(weekDoctrine(profileOf(), NOW)).toBeNull();
  });
});

describe('プロンプトに差し込む7日', () => {
  it('画面に出ている並びを、そのまま知らせる', () => {
    const text = weekDoctrine(steady(), NOW)!;

    expect(text).toContain('本人はもう見ている');
    expect(text).toContain('2026-10-02（金）【今日】');
    expect(text).toContain('土台は1週あたり 30km');
    // 曜日や種類は動かしてよいが、合計は増やさせない。
    expect(text).toContain('週の合計は増やさない');
  });
});


/**
 * コーチと話して決めた日。
 *
 * **ここを見ないと、「動かしておきました」と言われたものが翌朝には戻っている。**
 * 画面とコーチの言うことが食い違うと、コーチが二人いるのと同じになる。
 */
describe('会話で決めた日', () => {
  const planned = (date: string, title: string, intensity: 'rest' | 'easy' | 'moderate' | 'hard') => ({
    id: `pl-${date}`,
    date,
    title,
    steps: [title],
    rationale: '話して決めた',
    intensity,
    createdAt: `${dateDaysAgo(1)}T10:00:00.000Z`,
  });

  it('決めた日が、並びに出る', () => {
    const plan = weekPlan(steady({ plans: [planned('2026-10-04', '休み', 'rest')] }), NOW);
    const sunday = plan.days.find((day) => day.date === '2026-10-04')!;

    expect(sunday.kind).toBe('rest');
    expect(sunday.note).toBe('休み');
    expect(sunday.fromPlan).toBe(true);
    expect(sunday.km).toBeUndefined();
  });

  it('ロングを別の日へ移した形が、そのまま出る', () => {
    const plan = weekPlan(
      steady({
        plans: [planned('2026-10-04', '休み', 'rest'), planned('2026-10-03', 'ロング走 18km', 'moderate')],
      }),
      NOW,
    );

    expect(plan.days.find((day) => day.date === '2026-10-03')!.kind).toBe('long');
    expect(plan.days.find((day) => day.date === '2026-10-04')!.kind).toBe('rest');
  });

  /** 休みに替えた日のぶんは、ほかの日へ回す。合計は変えない。 */
  it('休みにした日のぶんを、週の合計から落とさない', () => {
    const before = weekPlan(steady(), NOW);
    const after = weekPlan(steady({ plans: [planned('2026-10-04', '休み', 'rest')] }), NOW);

    expect(after.totalKm).toBe(before.totalKm);
  });

  it('決めた日だと分かる印を、プロンプトにも載せる', () => {
    const text = weekDoctrine(steady({ plans: [planned('2026-10-04', '休み', 'rest')] }), NOW)!;

    expect(text).toContain('★あなたが決めた日');
    expect(text).toContain('勝手に組み替えないこと');
    expect(text).toContain('date を付けて残すこと');
  });
});


/**
 * **帯と並びで、今日の内容を食い違わせない。**
 * 画面の中でコーチが二人いることになる。今日の決め方（today.ts）が唯一の正。
 */
describe('今日の枠は、帯と同じにする', () => {
  it('昨日ポイント練習なら、今日の枠もイージーになる', () => {
    const profile = steady();
    const plan = weekPlan(
      profileOf({ activities: [...profile.activities, run(1, 20)] }),
      NOW,
    );
    expect(plan.days[0].kind).toBe('easy');
  });

  it('今日もう走っていれば、走る枠にしない', () => {
    const profile = steady();
    const plan = weekPlan(profileOf({ activities: [...profile.activities, run(0, 8)] }), NOW);

    expect(plan.days[0].kind).toBe('rest');
    expect(plan.days[0].label).toBe('走った');
  });
});
