import { describe, expect, it } from 'vitest';
import {
  fuelDoctrine,
  fuelPlanFor,
  gearQueryFor,
  gearSpecFor,
  raceDistanceKm,
  recentCadence,
} from '@/lib/gear-spec';
import { createDefaultProfile } from '@/lib/types';
import { addActivity, addRace, addShoes, applyProfileUpdate, upsertPain } from '@/lib/profile';
import type { RunnerProfile } from '@/lib/types';

const NOW = new Date('2026-09-24T09:00:00Z');
const base = () => createDefaultProfile('u1', NOW.toISOString());

function withGoal(profile: RunnerProfile, targetTime: string): RunnerProfile {
  return applyProfileUpdate(profile, { goal: { kind: 'time', summary: '目標', targetTime } }, NOW);
}

describe('大会の距離を読む', () => {
  it('「ハーフマラソン」をフルとして読まない', () => {
    expect(raceDistanceKm({ id: '1', name: '○○ハーフマラソン', date: '2026-11-01', priority: 'A' })).toBeCloseTo(
      21.0975,
      3,
    );
  });

  it('フル・ウルトラ・数値表記をそれぞれ読む', () => {
    expect(raceDistanceKm({ id: '1', name: '東京マラソン', date: '', distance: 'フル', priority: 'A' })).toBeCloseTo(
      42.195,
      3,
    );
    expect(raceDistanceKm({ id: '2', name: '山岳ウルトラ', date: '', priority: 'B' })).toBe(100);
    expect(raceDistanceKm({ id: '3', name: '記録会', date: '', distance: '30km', priority: 'C' })).toBe(30);
    expect(raceDistanceKm({ id: '4', name: '練習会', date: '', priority: 'C' })).toBeUndefined();
  });
});

describe('補給計画', () => {
  it('目標タイムから、ジェルの本数まで出す', () => {
    const profile = withGoal(base(), '3:30:00');
    const plan = fuelPlanFor(profile, NOW)!;

    expect(plan.minutes).toBe(210);
    expect(plan.totalCarbs).toBe(210); // 3.5時間 × 60g
    expect(plan.gels).toBe(6);
    expect(plan.intervalMin).toBeGreaterThan(20);
  });

  it('体重が分かれば、カフェインの上限まで決まる', () => {
    const profile = applyProfileUpdate(withGoal(base(), '3:00:00'), { bodyWeightKg: 58 }, NOW);
    expect(fuelPlanFor(profile, NOW)!.caffeineCapMg).toBe(174);
  });

  it('90分に満たない目標では、そもそも要らないと答える', () => {
    const profile = applyProfileUpdate(
      base(),
      { goal: { kind: 'time', summary: '10km', targetTime: '0:45:00' } },
      NOW,
    );
    expect(fuelPlanFor(profile, NOW)).toBeNull();
  });

  it('目標が無ければ計算しない（推測で本数を言わない）', () => {
    expect(fuelPlanFor(base(), NOW)).toBeNull();
    expect(fuelDoctrine(base(), NOW)).toBeNull();
  });

  it('大会ごとの目標タイムは、全体の目標より優先される', () => {
    const profile = addRace(
      withGoal(base(), '3:00:00'),
      { name: 'ハーフ大会', date: '2026-10-20', distance: 'ハーフ', targetTime: '1:35:00', priority: 'A' },
      NOW,
    );
    expect(fuelPlanFor(profile, NOW)!.minutes).toBe(95);
  });

  it('計算済みの数字はプロンプトに載り、計算し直すなと言い添える', () => {
    const text = fuelDoctrine(withGoal(base(), '3:30:00'), NOW)!;
    expect(text).toContain('ジェルは6本');
    expect(text).toContain('計算し直さない');
  });
});

describe('ピッチ', () => {
  it('読み取れた回の真ん中の値を取る', () => {
    let profile = base();
    for (const cadence of [160, 164, 168]) {
      profile = addActivity(profile, { date: '2026-09-20', type: 'run', metrics: { cadence } }, NOW);
    }
    expect(recentCadence(profile)).toBe(164);
  });

  it('一度も読み取れていなければ、何も答えない', () => {
    expect(recentCadence(base())).toBeUndefined();
  });
});

describe('シューズの条件', () => {
  it('週の走行距離が多い人には、2足を交互に履く前提で条件を出す', () => {
    const profile = applyProfileUpdate(base(), { weeklyVolumeKm: 70 }, NOW);
    const spec = gearSpecFor('shoes-daily', profile, NOW)!;
    expect(spec.requirements[0]).toContain('2足');
    expect(spec.skipIf).toBeTruthy();
  });

  it('故障歴から、満たすべき条件が変わる', () => {
    const profile = applyProfileUpdate(
      base(),
      { injuryHistory: ['足底腱膜炎', '外反母趾'], bodyWeightKg: 74 },
      NOW,
    );
    const spec = gearSpecFor('shoes-daily', profile, NOW)!;
    const text = spec.requirements.join('\n');

    expect(text).toContain('ドロップ');
    expect(text).toContain('ワイド');
    expect(spec.query).toContain('ワイド');
    expect(spec.query).toContain('クッション');
  });

  it('いま痛みがある部位も、故障歴と同じように効く', () => {
    const profile = upsertPain(base(), { site: '右膝の外側', severity: 2, status: 'active' }, NOW);
    expect(gearSpecFor('shoes-daily', profile, NOW)!.requirements.join('\n')).toContain('膝が内へ入りやすく');
  });

  it('ピッチが低い人には、クッション量を優先させる', () => {
    let profile = base();
    profile = addActivity(profile, { date: '2026-09-20', type: 'run', metrics: { cadence: 162 } }, NOW);
    expect(gearSpecFor('shoes-daily', profile, NOW)!.requirements.join('\n')).toContain('162spm');
  });

  it('本番が近すぎる時は、レースシューズを新調させない', () => {
    const profile = addRace(
      withGoal(base(), '3:00:00'),
      { name: '本番', date: '2026-10-05', distance: 'フル', priority: 'A' },
      NOW,
    );
    expect(gearSpecFor('shoes-race', profile, NOW)!.timing).toContain('勧めない');
  });

  it('本番まで余裕があれば、いつまでに慣らすかを示す', () => {
    const profile = addRace(
      withGoal(base(), '3:00:00'),
      { name: '本番', date: '2026-11-15', distance: 'フル', priority: 'A' },
      NOW,
    );
    const spec = gearSpecFor('shoes-race', profile, NOW)!;
    expect(spec.timing).toContain('3回');
    expect(spec.query).toContain('カーボン');
  });
});

describe('今履いている靴を踏まえる', () => {
  it('まだ余裕があれば、急がなくていいと言う', () => {
    const profile = addShoes(applyProfileUpdate(base(), { weeklyVolumeKm: 40 }, NOW), { name: 'A', km: 120 }, NOW);
    expect(gearSpecFor('shoes-daily', profile, NOW)!.skipIf).toContain('残り580km');
  });

  it('寿命が近ければ、残りの距離を条件に入れる', () => {
    const profile = addShoes(applyProfileUpdate(base(), { weeklyVolumeKm: 50 }, NOW), { name: 'A', km: 620 }, NOW);
    const spec = gearSpecFor('shoes-daily', profile, NOW)!;

    expect(spec.requirements[0]).toContain('残り80km');
    expect(spec.skipIf).toContain('履き切ってから');
  });

  it('目安を超えていれば、超えていると言う', () => {
    const profile = addShoes(base(), { name: 'A', km: 900 }, NOW);
    expect(gearSpecFor('shoes-daily', profile, NOW)!.requirements[0]).toContain('すでに超えている');
  });
});

describe('ジェルの条件', () => {
  it('本数と、試すタイミングまで含めて出す', () => {
    const profile = addRace(
      withGoal(base(), '3:30:00'),
      { name: '本番', date: '2026-12-06', distance: 'フル', priority: 'A' },
      NOW,
    );
    const spec = gearSpecFor('gels', profile, NOW)!;

    expect(spec.quantity).toBe('6本');
    expect(spec.requirements.join('\n')).toContain('6本');
    expect(spec.timing).toContain('ロング走');
  });

  it('本番直前は、初めての銘柄を増やさせない', () => {
    const profile = addRace(
      withGoal(base(), '3:30:00'),
      { name: '本番', date: '2026-10-01', distance: 'フル', priority: 'A' },
      NOW,
    );
    expect(gearSpecFor('gels', profile, NOW)!.timing).toContain('初めて使うものを増やさない');
  });
});

describe('検索語', () => {
  it('知らないカテゴリには何も答えない', () => {
    expect(gearSpecFor('rocket', base(), NOW)).toBeNull();
  });

  it('モデルが足した語を検索語に混ぜる', () => {
    const query = gearQueryFor('socks', base(), '五本指', NOW);
    expect(query).toContain('五本指');
  });
});
