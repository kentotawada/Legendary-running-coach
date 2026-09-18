import { describe, expect, it } from 'vitest';
import {
  addActivity,
  applyProfileUpdate,
  replaceInjuryHistory,
  setGoal,
  setPhase,
  setPlan,
  summarizeProfile,
  toDisplayMessages,
  upsertPain,
} from '@/lib/profile';
import { createDefaultProfile } from '@/lib/types';
import { INTERNAL_PREFIX } from '@/lib/prompt';

const NOW = new Date('2026-09-16T09:00:00Z');

describe('applyProfileUpdate', () => {
  it('分かった項目だけを足し、既存の値を消さない', () => {
    const base = applyProfileUpdate(
      createDefaultProfile('u1'),
      { displayName: 'ケント', weeklyVolumeKm: 30 },
      NOW,
    );
    const next = applyProfileUpdate(base, { bodyWeightKg: 62 }, NOW);

    expect(next.displayName).toBe('ケント');
    expect(next.weeklyVolumeKm).toBe(30);
    expect(next.bodyWeightKg).toBe(62);
  });

  it('制約と原動力は重複させずに積み上げる', () => {
    const first = applyProfileUpdate(
      createDefaultProfile('u1'),
      { constraints: ['平日は朝しか走れない'] },
      NOW,
    );
    const second = applyProfileUpdate(
      first,
      { constraints: ['平日は朝しか走れない', '日曜は家族の予定'] },
      NOW,
    );
    expect(second.constraints).toEqual(['平日は朝しか走れない', '日曜は家族の予定']);
  });

  it('目標は部分更新できる', () => {
    const withGoal = applyProfileUpdate(
      createDefaultProfile('u1'),
      { goal: { kind: 'time', summary: 'サブスリー' } },
      NOW,
    );
    const withDate = applyProfileUpdate(withGoal, { goal: { raceDate: '2027-02-28' } }, NOW);

    expect(withDate.goal).toMatchObject({ kind: 'time', summary: 'サブスリー', raceDate: '2027-02-28' });
  });
});

describe('upsertPain', () => {
  it('同じ部位は上書きし、増やさない', () => {
    const first = upsertPain(createDefaultProfile('u1'), { site: '右膝 外側', severity: 3 }, NOW);
    const second = upsertPain(first, { site: '右膝外側', severity: 1, status: 'improving' }, NOW);

    expect(second.pains).toHaveLength(1);
    expect(second.pains[0]).toMatchObject({ severity: 1, status: 'improving' });
  });

  it('severity 0 は解消として扱う', () => {
    const profile = upsertPain(createDefaultProfile('u1'), { site: '右膝', severity: 0 }, NOW);
    expect(profile.pains[0].status).toBe('resolved');
  });

  it('範囲外の severity は 0-5 に丸める', () => {
    const profile = upsertPain(createDefaultProfile('u1'), { site: '腰', severity: 9 }, NOW);
    expect(profile.pains[0].severity).toBe(5);
  });
});

describe('setPhase', () => {
  it('変化した時だけ履歴を残す', () => {
    const toGoal = setPhase(createDefaultProfile('u1'), 'goal', 'フルマラソンに申し込んだ', NOW);
    const again = setPhase(toGoal, 'goal', '同じ', NOW);

    expect(toGoal.phaseHistory).toHaveLength(1);
    expect(toGoal.phaseHistory[0]).toMatchObject({ from: 'unknown', to: 'goal' });
    expect(again.phaseHistory).toHaveLength(1);
  });
});

describe('setPlan', () => {
  it('同じ日のメニューは組み替えられる', () => {
    const first = setPlan(
      createDefaultProfile('u1'),
      { date: '2026-09-16', title: '40分ジョグ', steps: ['40分'], rationale: '土台づくり', intensity: 'easy' },
      NOW,
    );
    const rebuilt = setPlan(
      first,
      { date: '2026-09-16', title: '完全休養', steps: ['休む'], rationale: '疲労が強い', intensity: 'rest' },
      NOW,
    );

    expect(rebuilt.plans).toHaveLength(1);
    expect(rebuilt.plans[0].title).toBe('完全休養');
  });
});

describe('summarizeProfile', () => {
  it('目標をまだ言葉にしていない人には、走力を聞き出すところから始めさせる', () => {
    const summary = summarizeProfile(createDefaultProfile('u1'), NOW);
    expect(summary).toContain('走力を聞き出し');
  });

  it('心拍の基準値が無ければ、推測せず尋ねるよう明記する', () => {
    expect(summarizeProfile(createDefaultProfile('u1'), NOW)).toContain('推測せず最大心拍かLTHRを尋ねる');
  });

  it('レースまでの残り日数を計算して渡す', () => {
    const profile = applyProfileUpdate(
      createDefaultProfile('u1'),
      { goal: { kind: 'race', summary: '初フル完走', raceDate: '2026-09-26' } },
      NOW,
    );
    expect(summarizeProfile(profile, NOW)).toContain('あと10日');
  });

  it('直近の行動を載せる', () => {
    const profile = addActivity(
      createDefaultProfile('u1'),
      { date: '2026-09-15', type: 'walk', durationMin: 15, felt: '思ったより気持ちよかった' },
      NOW,
    );
    const summary = summarizeProfile(profile, NOW);
    expect(summary).toContain('2026-09-15 ウォーク');
    expect(summary).toContain('思ったより気持ちよかった');
  });
});

describe('toDisplayMessages', () => {
  it('内部指示と思考パートは画面に出さない', () => {
    const messages = toDisplayMessages([
      { role: 'user', parts: [{ text: `${INTERNAL_PREFIX}初回の指示` }] },
      { role: 'model', parts: [{ text: '考え中', thought: true }, { text: 'はじめまして！' }] },
      { role: 'user', parts: [{ text: 'よろしくお願いします' }] },
      { role: 'user', parts: [{ functionResponse: { name: 'log_condition', response: { ok: true } } }] },
    ]);

    expect(messages).toEqual([
      { id: '1', role: 'coach', text: 'はじめまして！' },
      { id: '2', role: 'user', text: 'よろしくお願いします' },
    ]);
  });
});

describe('本人による設定変更', () => {
  it('目標を差し替えると、前の目標の情報は残らない', () => {
    const sub3 = setGoal(
      createDefaultProfile('u1'),
      { kind: 'time', summary: 'サブ3', targetTime: '2:59:59', raceName: '東京マラソン' },
      NOW,
    );
    const sub4 = setGoal(sub3, { kind: 'time', summary: 'サブ4', targetTime: '3:59:59' }, NOW);

    expect(sub4.goal).toEqual({ kind: 'time', summary: 'サブ4', targetTime: '3:59:59' });
    expect(sub4.goal?.raceName).toBeUndefined();
  });

  it('故障歴は追記ではなく置き換え（間違えた項目を消せるように）', () => {
    const first = replaceInjuryHistory(createDefaultProfile('u1'), ['右膝', '左足底'], NOW);
    const corrected = replaceInjuryHistory(first, ['右膝'], NOW);

    expect(corrected.injuryHistory).toEqual(['右膝']);
  });

  it('空にすれば故障歴を消せる', () => {
    const withInjury = replaceInjuryHistory(createDefaultProfile('u1'), ['右膝'], NOW);
    expect(replaceInjuryHistory(withInjury, [], NOW).injuryHistory).toBeUndefined();
  });

  it('空行や空白だけの行は落とす', () => {
    const profile = replaceInjuryHistory(createDefaultProfile('u1'), ['  右膝  ', '', '   '], NOW);
    expect(profile.injuryHistory).toEqual(['右膝']);
  });
});
