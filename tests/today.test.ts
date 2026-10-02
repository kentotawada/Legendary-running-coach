import { describe, expect, it } from 'vitest';
import { CONDITIONS, hasRunHistory, todayDoctrine, todayFatigue, todayPlan } from '@/lib/today';
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

  /**
   * **目標が無くても、走っていれば数字が出せる。**
   * イージーの土台は走れている力から出すので、目標の有無では決まらない。
   */
  it('目標が無くても、走った記録があればペースで渡す', () => {
    const plan = todayPlan(regular(), NOW);
    const text = plan.steps.map((step) => step.detail ?? '').join(' ');
    expect(text).toMatch(/\d:\d\d\/km〜\d:\d\d\/km/);
  });

  /** 目標も記録も無い人にだけ、言葉で渡す。**ここでも黙らない。** */
  it('目標も記録も無ければ、言葉で渡す', () => {
    const plan = todayPlan(profileOf({ activities: [] }), NOW);
    const text = `${plan.headline} ${plan.why} ${plan.steps.map((step) => step.detail ?? '').join(' ')}`;
    expect(text).not.toMatch(/\d:\d\d\/km〜\d:\d\d\/km/);
    expect(text.length).toBeGreaterThan(0);
  });

  it('目標があれば、その人のペースで出す', () => {
    const plan = todayPlan(
      regular({ goal: { kind: 'time', summary: 'サブ3.5', targetTime: '3:30:00' } }),
      NOW,
    );
    const text = plan.steps.map((step) => step.detail ?? '').join(' ');
    expect(text).toMatch(/\d:\d\d\/km〜\d:\d\d\/km/);
  });

  /**
   * **崩せない予定は、守れなかった日にアプリを開かない理由になる。**
   * ただし初日（記録ゼロ）は別。まだ、できない予定そのものが無い。
   */
  it('予定を出す日には、逃げ道を必ず置く', () => {
    const cases = [
      regular(),
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


/**
 * 朝に押した、今日の体の感じ。
 *
 * **押した意味が無いと、二度と押されない。**
 * 「重い」と言ったのに同じメニューが出ていたら、それはただのアンケート。
 */
describe('今朝の体の感じ', () => {
  const todayDate = dateDaysAgo(0);
  const withCondition = (fatigue: number, extra: Partial<RunnerProfile> = {}) => ({
    ...regular(extra),
    conditionLogs: [
      { id: 'c1', date: todayDate, fatigue, createdAt: `${todayDate}T07:00:00.000Z` },
    ],
  });

  it('押した段階を読み取る', () => {
    expect(todayFatigue(withCondition(4), NOW)).toBe(4);
    expect(todayFatigue(regular(), NOW)).toBeUndefined();
  });

  it('3つだけ。朝に4つも押させない', () => {
    expect(CONDITIONS.map((item) => item.label)).toEqual(['軽い', 'ふつう', '重い']);
  });

  it('重い日は、短くする', () => {
    const plan = todayPlan(withCondition(4), NOW);

    expect(plan.intensity).toBe('easy');
    expect(plan.headline).toMatch(/短め|軽くします/);
    expect(plan.why).toContain('体が重い');
    // **元が何だったかを言う。** 黙って変えると、決まりが毎日動いて見える。
    expect(plan.why).toContain('元の予定は');
    expect(plan.alternatives.some((a) => a.when.includes('3日続けて'))).toBe(true);
  });

  it('重い日でも、途中でやめてよいと書く', () => {
    const plan = todayPlan(withCondition(4), NOW);
    expect(plan.steps.some((step) => step.label.includes('途中でやめて'))).toBe(true);
  });

  /** **軽い日に距離を足さない。** 気分のいい日の上積みが、いちばん多い故障の入口。 */
  it('軽い日でも距離は足さず、流しだけ足す', () => {
    const light = todayPlan(withCondition(1), NOW);
    const plain = todayPlan(regular(), NOW);

    expect(light.summary).toBe(plain.summary);
    expect(light.steps.some((step) => step.label === '流し')).toBe(true);
    expect(light.why).toContain('距離は足しません');
  });

  it('ふつうなら、何も変えない', () => {
    expect(todayPlan(withCondition(2), NOW).headline).toBe(todayPlan(regular(), NOW).headline);
  });

  /** **痛みとレースは、体の感じより強い理由で決まっている。** */
  it('痛みの日には触らない', () => {
    const plan = todayPlan(
      withCondition(1, {
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
      }),
      NOW,
    );
    expect(plan.source).toBe('pain');
    expect(plan.running).toBe(false);
  });

  it('レース当日にも触らない', () => {
    const plan = todayPlan(
      withCondition(4, {
        races: [
          { id: 'r1', name: '湘南国際', date: dateDaysAgo(0), distance: 'フル', priority: 'A' as const },
        ],
      }),
      NOW,
    );
    expect(plan.source).toBe('race');
    expect(plan.headline).toContain('いってらっしゃい');
  });

  it('押したことを、コーチにも伝える', () => {
    expect(todayDoctrine(withCondition(4), NOW)).toContain('体が重い');
    expect(todayDoctrine(withCondition(1), NOW)).toContain('距離は足さない');
    expect(todayDoctrine(regular(), NOW)).toContain('催促はしない');
  });
});


/**
 * 今日の空気。
 *
 * **走る前に言うから意味がある。**
 * 走り終えてから「暑さの影響がありました」は、記録の説明にはなっても、
 * 走る前の判断には1秒も役に立たない。
 */
describe('暑い日の今日やること', () => {
  const hot = (extra: Partial<RunnerProfile> = {}) => ({
    ...regular({ goal: { kind: 'time', summary: 'サブ3.5', targetTime: '3:30:00' }, ...extra }),
    weather: { temperatureC: 29, humidity: 80, at: NOW.toISOString() },
  });

  it('落とす目安を、手順と見出しに足す', () => {
    const plan = todayPlan(hot(), NOW);

    expect(plan.weather).toBeTruthy();
    expect(plan.weather!.headline).toContain('29度');
    expect(plan.steps.some((step) => step.label.includes('29度'))).toBe(true);
  });

  /** **ペースそのものは書き換えない。** 暑さは「落とす」話で、「やめる」話ではない。 */
  it('元のペースは書き換えない', () => {
    const plain = todayPlan(regular({ goal: { kind: 'time', summary: 'サブ3.5', targetTime: '3:30:00' } }), NOW);
    const warm = todayPlan(hot(), NOW);

    expect(warm.summary).toBe(plain.summary);
    expect(warm.headline).toBe(plain.headline);
  });

  it('涼しい日は、何も足さない', () => {
    const cool = {
      ...regular(),
      weather: { temperatureC: 12, humidity: 50, at: NOW.toISOString() },
    };
    expect(todayPlan(cool, NOW).weather).toBeUndefined();
  });

  /** 古い読みで「今日は暑い」と言わない。 */
  it('3時間より古い読みは使わない', () => {
    const stale = {
      ...regular(),
      weather: {
        temperatureC: 29,
        humidity: 80,
        at: new Date(NOW.getTime() - 5 * 3_600_000).toISOString(),
      },
    };
    expect(todayPlan(stale, NOW).weather).toBeUndefined();
  });

  it('走らない日には出さない', () => {
    const resting = {
      ...hot(),
      activities: [...regular().activities, run(0, 10)],
    };
    expect(todayPlan(resting, NOW).weather).toBeUndefined();
  });

  it('暑さのことを、コーチにも伝える', () => {
    const text = todayDoctrine(hot(), NOW);
    expect(text).toContain('今日の空気');
    expect(text).toContain('目標ペースをそのまま勧めないこと');
  });
});


/**
 * 記録が1本も無い人。
 *
 * **募集で来るのは、全員この状態。** ここで距離を断定すると、
 * 週40km走る人には少なすぎ、これから始める人には多すぎる。どちらにも外れる。
 */
describe('まだ記録が無い人', () => {
  it('記録を持っているかを見分ける', () => {
    expect(hasRunHistory(profileOf())).toBe(false);
    expect(hasRunHistory(regular())).toBe(true);
    // 歩きだけ、距離の無い記録だけなら、まだ分からない。
    expect(
      hasRunHistory(profileOf({ activities: [{ ...run(1, 5), type: 'walk' as const }] })),
    ).toBe(false);
    expect(hasRunHistory(profileOf({ activities: [{ ...run(1, 5), distanceKm: undefined }] }))).toBe(false);
  });

  it('距離を断定しない', () => {
    const plan = todayPlan(profileOf(), NOW);

    expect(plan.source).toBe('start');
    expect(plan.headline).toBe('まず、1本おしえてください');
    expect(plan.summary).toBeUndefined();
    // 画面に出る文に、km の数字を置かない。
    expect(`${plan.headline}${plan.why}`).not.toMatch(/\d+km/);
  });

  it('なぜ出せないのかを、正直に書く', () => {
    const plan = todayPlan(profileOf(), NOW);
    expect(plan.why).toContain('まだ分かりません');
    expect(plan.why).toContain('1本入れば');
  });

  it('次にやれば中身が埋まることを、順に出す', () => {
    const steps = todayPlan(profileOf(), NOW).steps.map((step) => step.label);
    expect(steps).toContain('走った記録を送る');
    expect(steps).toContain('つないでおく');
  });

  /** **初日に「できない日のために」は要らない。** まだ、できない予定が無い。 */
  it('逃げ道は置かない', () => {
    expect(todayPlan(profileOf(), NOW).alternatives).toEqual([]);
  });

  it('1本入ったら、ふつうの出し方に戻る', () => {
    const plan = todayPlan(profileOf({ activities: [run(1, 8)] }), NOW);
    expect(plan.source).not.toBe('start');
    expect(plan.headline).toBeTruthy();
  });
});
