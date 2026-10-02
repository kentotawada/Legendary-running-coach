import { describe, expect, it } from 'vitest';
import { todayDoctrine, todayPlan } from '@/lib/today';
import { createDefaultProfile } from '@/lib/types';
import type { ActivityLog, RunnerProfile } from '@/lib/types';

/**
 * 今日やること。
 *
 * **開いた瞬間に出るものなので、間違えると毎朝間違える。**
 * 守るのは3つ。痛みが何より優先されること、記録が無い人にも必ず何かを返すこと、
 * そして必ず崩せること（守れない予定は、守れなかった日に開かない理由になる）。
 */

const NOW = new Date('2026-10-02T07:00:00+09:00');

function dateDaysAgo(days: number): string {
  const d = new Date('2026-10-02T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function run(daysAgo: number, km: number, session?: string): ActivityLog {
  const date = dateDaysAgo(daysAgo);
  return {
    id: `a${daysAgo}-${km}`,
    date,
    type: 'run',
    session,
    distanceKm: km,
    durationMin: Math.round(km * 5.5),
    createdAt: `${date}T10:00:00.000Z`,
  };
}

function profileOf(extra: Partial<RunnerProfile> = {}): RunnerProfile {
  return { ...createDefaultProfile('u1', '2026-06-01T00:00:00.000Z'), ...extra };
}

/** ふだん1本8km、週4回くらい走っている人。 */
function regular(extra: Partial<RunnerProfile> = {}): RunnerProfile {
  const activities: ActivityLog[] = [];
  for (let day = 3; day <= 28; day += 2) activities.push(run(day, 8));
  return profileOf({ activities, ...extra });
}

describe('痛みは、何より先に来る', () => {
  const hurt = () =>
    regular({
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

  it('痛みがあれば走らせない', () => {
    const plan = todayPlan(hurt(), NOW);

    expect(plan.running).toBe(false);
    expect(plan.intensity).toBe('rest');
    expect(plan.source).toBe('pain');
    expect(plan.headline).toBe('今日は走りません');
    expect(plan.why).toContain('右膝の外側');
  });

  /** **レースの日でも、コーチが決めた予定でも、痛みが勝つ。** */
  it('レース当日でも、コーチの予定があっても、痛みが勝つ', () => {
    const profile = {
      ...hurt(),
      races: [{ id: 'r1', name: '湘南国際', date: dateDaysAgo(0), distance: 'フル', priority: 'A' as const }],
      plans: [
        {
          id: 'pl1',
          date: dateDaysAgo(0),
          title: '閾値走 20分',
          steps: ['ウォームアップ15分', '閾値20分'],
          rationale: '週の刺激',
          intensity: 'moderate' as const,
          createdAt: `${dateDaysAgo(1)}T10:00:00.000Z`,
        },
      ],
    };
    expect(todayPlan(profile, NOW).source).toBe('pain');
    expect(todayPlan(profile, NOW).running).toBe(false);
  });

  it('休む日にも、やることを置く', () => {
    const plan = todayPlan(hurt(), NOW);
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.alternatives.some((a) => a.when.includes('2週間'))).toBe(true);
  });
});

describe('コーチが決めた予定', () => {
  it('会話で決めたものを、そのまま出す', () => {
    const profile = regular({
      plans: [
        {
          id: 'pl1',
          date: dateDaysAgo(0),
          title: '閾値走 20分',
          steps: ['ウォームアップ15分', '閾値20分 4:04/km', 'クールダウン10分'],
          rationale: '大会まで6週。ここで閾値を上げておきたい。',
          intensity: 'moderate',
          estimatedMinutes: 55,
          alternatives: [{ when: '脚が重い時', what: '15分に短縮してよい' }],
          createdAt: `${dateDaysAgo(1)}T10:00:00.000Z`,
        },
      ],
    });
    const plan = todayPlan(profile, NOW);

    expect(plan.source).toBe('plan');
    expect(plan.headline).toBe('閾値走 20分');
    expect(plan.summary).toBe('55分');
    expect(plan.why).toBe('大会まで6週。ここで閾値を上げておきたい。');
    expect(plan.steps).toHaveLength(3);
    expect(plan.alternatives).toHaveLength(1);
  });

  it('昨日の予定は、今日のものにしない', () => {
    const profile = regular({
      plans: [
        {
          id: 'pl1',
          date: dateDaysAgo(1),
          title: '閾値走 20分',
          steps: ['閾値20分'],
          rationale: '昨日の分',
          intensity: 'moderate',
          createdAt: `${dateDaysAgo(2)}T10:00:00.000Z`,
        },
      ],
    });
    expect(todayPlan(profile, NOW).source).not.toBe('plan');
  });
});

describe('積みすぎている週', () => {
  it('増やすのを止める日にする', () => {
    const activities: ActivityLog[] = [];
    for (let day = 7; day < 35; day += 1) {
      if (day % 7 === 0) continue;
      activities.push(run(day, 5));
    }
    // 直近7日で60km。直前4週の平均は30km。
    [1, 2, 3, 4, 5, 6].forEach((day) => activities.push(run(day, 10)));

    const plan = todayPlan(profileOf({ activities }), NOW);
    expect(plan.source).toBe('workload');
    expect(plan.headline).toBe('今日は増やさない日');
    expect(plan.why).toContain('2倍');
    // **走るなとは言わない。** 増やすのを止めるだけ。
    expect(plan.running).toBe(true);
    expect(plan.intensity).toBe('easy');
  });
});

describe('昨日までの並びで決める', () => {
  it('今日もう走っていれば、戻すことを出す', () => {
    const profile = regular();
    const plan = todayPlan(profileOf({ activities: [...profile.activities, run(0, 10)] }), NOW);

    expect(plan.headline).toBe('今日はもう走っています');
    expect(plan.running).toBe(false);
    expect(plan.intensity).toBe('rest');
  });

  it('昨日がポイント練習なら、今日は戻す日', () => {
    const profile = regular();
    const plan = todayPlan(
      profileOf({ activities: [...profile.activities, run(1, 12, '閾値走')] }),
      NOW,
    );

    expect(plan.headline).toBe('今日は、脚を戻す日');
    expect(plan.why).toContain('ポイント練習');
    expect(plan.intensity).toBe('easy');
  });

  it('昨日が飛び抜けて長ければ、同じく戻す日', () => {
    // 週の積み方そのものは無理のない人。長い1本だけが飛び抜けている形。
    const activities: ActivityLog[] = [];
    for (let day = 3; day <= 33; day += 2) activities.push(run(day, 10));
    activities.push(run(1, 24));

    const plan = todayPlan(profileOf({ activities }), NOW);
    expect(plan.headline).toBe('今日は、脚を戻す日');
    expect(plan.why).toContain('24km');
  });

  /**
   * **積みすぎのほうが、昨日1本より強い。**
   * 昨日の1本は今日の脚の話だが、週の積み方は故障の話になる。
   */
  it('週が急な時は、昨日の話より積み方を先に出す', () => {
    const activities: ActivityLog[] = [];
    for (let day = 7; day < 35; day += 1) {
      if (day % 7 === 0) continue;
      activities.push(run(day, 5));
    }
    [1, 2, 3, 4, 5, 6].forEach((day) => activities.push(run(day, 10)));
    activities.push(run(1, 24, '閾値走'));

    expect(todayPlan(profileOf({ activities }), NOW).source).toBe('workload');
  });

  it('しばらく空いていれば、軽く戻す', () => {
    const plan = todayPlan(profileOf({ activities: [run(9, 8), run(11, 8), run(13, 8)] }), NOW);

    expect(plan.headline).toBe('軽く、戻すところから');
    expect(plan.why).toContain('9日ぶり');
  });

  it('2日続けて走っていれば、休んでよい日として出す', () => {
    const profile = regular();
    const plan = todayPlan(
      profileOf({ activities: [...profile.activities, run(1, 8), run(2, 8)] }),
      NOW,
    );
    expect(plan.headline).toBe('休んでも、軽く走ってもいい日');
  });

  it('ふだんどおりの日は、イージーを出す', () => {
    const plan = todayPlan(regular(), NOW);
    expect(plan.headline).toContain('イージー');
    expect(plan.intensity).toBe('easy');
    expect(plan.why).toContain('週の8割');
  });
});

describe('レース', () => {
  const withRace = (daysOut: number) =>
    regular({
      races: [
        {
          id: 'r1',
          name: '湘南国際マラソン',
          date: dateDaysAgo(-daysOut),
          distance: 'フル',
          targetTime: '3:30:00',
          priority: 'A' as const,
        },
      ],
    });

  it('当日は、送り出す', () => {
    const plan = todayPlan(withRace(0), NOW);
    expect(plan.source).toBe('race');
    expect(plan.headline).toContain('いってらっしゃい');
    expect(plan.why).toContain('前半を抑えて');
  });

  it('前日は、短く動かすだけにする', () => {
    const plan = todayPlan(withRace(1), NOW);
    expect(plan.source).toBe('race');
    expect(plan.headline).toContain('あと1日');
    expect(plan.intensity).toBe('easy');
    expect(plan.alternatives[0].what).toContain('休んでよい');
  });
});

describe('どんな人にも、必ず何かを返す', () => {
  /** **「分かりません」は、いちばん最初に開いた人にいちばん多く出る。** */
  it('記録が1本も無くても出す', () => {
    const plan = todayPlan(profileOf(), NOW);

    expect(plan.headline).toBeTruthy();
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.why).toBeTruthy();
  });

  it('目標が無くても、強度の目安を言葉で渡す', () => {
    const plan = todayPlan(regular(), NOW);
    const text = plan.steps.map((step) => step.detail ?? '').join(' ');
    expect(text).toContain('鼻呼吸で会話できる速さ');
  });

  it('目標があれば、その人のペースで出す', () => {
    const plan = todayPlan(
      regular({ goal: { kind: 'time', summary: 'サブ3.5', targetTime: '3:30:00' } }),
      NOW,
    );
    const text = plan.steps.map((step) => step.detail ?? '').join(' ');
    expect(text).toMatch(/\d:\d\d\/km〜\d:\d\d\/km/);
  });

  /** **崩せない予定は、守れなかった日にアプリを開かない理由になる。** */
  it('どの日にも、逃げ道を必ず置く', () => {
    const cases = [
      regular(),
      profileOf(),
      regular({ activities: [...regular().activities, run(1, 12, '閾値走')] }),
      profileOf({ activities: [run(9, 8), run(11, 8), run(13, 8)] }),
    ];
    for (const profile of cases) {
      expect(todayPlan(profile, NOW).alternatives.length).toBeGreaterThan(0);
    }
  });

  /** 画面には地の文として出る。記号が混ざるとそのまま文字で見える。 */
  it('画面に出す文に、記号を混ぜない', () => {
    const plan = todayPlan(regular(), NOW);
    const all = `${plan.headline}${plan.summary ?? ''}${plan.why}`;
    expect(all).not.toContain('**');
  });
});

describe('プロンプトに差し込む今日の予定', () => {
  it('画面に出ているものを、そのまま知らせる', () => {
    const text = todayDoctrine(regular(), NOW);

    expect(text).toContain('本人はもう見ている');
    expect(text).toContain('イージー');
    expect(text).toContain('画面と違うことを言わない');
  });

  it('自動で出したものは、会話で決め直してよいと伝える', () => {
    const text = todayDoctrine(regular(), NOW);
    expect(text).toContain('set_today_plan');
  });

  it('コーチが決めたものは、覚えている前提で話させる', () => {
    const profile = regular({
      plans: [
        {
          id: 'pl1',
          date: dateDaysAgo(0),
          title: '閾値走 20分',
          steps: ['閾値20分'],
          rationale: '大会まで6週',
          intensity: 'moderate',
          createdAt: `${dateDaysAgo(1)}T10:00:00.000Z`,
        },
      ],
    });
    expect(todayDoctrine(profile, NOW)).toContain('あなたが会話の中で決めたもの');
  });
});
