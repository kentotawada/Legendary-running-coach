import { describe, expect, it } from 'vitest';
import { coachTools, executeTool } from '@/lib/tools';
import { createDefaultProfile } from '@/lib/types';

const NOW = new Date('2026-09-16T09:00:00Z');
const base = () => createDefaultProfile('u1', NOW.toISOString());

describe('coachTools', () => {
  it('コーチが学習に使う道具が一式そろっている', () => {
    expect(coachTools.map((t) => t.name).sort()).toEqual([
      'add_race',
      'find_gear',
      'log_activity',
      'log_condition',
      'log_weight',
      'remove_race',
      'set_coaching_phase',
      'set_today_plan',
      'update_pain',
      'update_runner_profile',
    ]);
  });
});

describe('executeTool', () => {
  it('痛みを記録したら、走行が許されないことをモデルに返す', () => {
    const { profile, result } = executeTool(
      base(),
      'update_pain',
      { site: '右膝の外側', severity: 3, description: '着地のたびに刺すように痛む' },
      NOW,
    );

    expect(profile.pains[0].site).toBe('右膝の外側');
    expect(result.runningAllowed).toBe(false);
    expect(String(result.message)).toContain('走行メニューは一切提案してはならない');
  });

  it('痛みが解消したら、段階的な再開を促す', () => {
    const hurt = executeTool(base(), 'update_pain', { site: '右膝', severity: 3 }, NOW).profile;
    const { result } = executeTool(hurt, 'update_pain', { site: '右膝', severity: 0 }, NOW);
    expect(result.runningAllowed).toBe(true);
    expect(String(result.message)).toContain('段階的に');
  });

  it('引数が壊れていても落ちず、聞き直させる', () => {
    const { profile, result } = executeTool(base(), 'update_pain', { severity: 2 }, NOW);
    expect(result.ok).toBe(false);
    expect(profile.pains).toHaveLength(0);
  });

  it('文字列で来た数値も受け取る', () => {
    const { profile } = executeTool(base(), 'log_condition', { fatigue: '4', availableMinutes: '20' }, NOW);
    expect(profile.conditionLogs[0]).toMatchObject({ fatigue: 4, availableMinutes: 20 });
  });

  it('日付が無ければ今日として記録する', () => {
    const { profile } = executeTool(base(), 'log_activity', { type: 'walk', durationMin: 15 }, NOW);
    expect(profile.activities[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('未知の種別は受け付けず、選択肢を返す', () => {
    const { result } = executeTool(base(), 'log_activity', { type: 'swimming' }, NOW);
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain('cross');
  });

  it('代替案の無いメニューには、逃げ道を足すよう促す', () => {
    const { result } = executeTool(
      base(),
      'set_today_plan',
      { title: '40分ジョグ', steps: ['40分'], rationale: '土台づくり', intensity: 'easy' },
      NOW,
    );
    expect(String(result.message)).toContain('逃げ道');
  });

  it('代替案があれば、そのまま記録する', () => {
    const { profile, result } = executeTool(
      base(),
      'set_today_plan',
      {
        title: '40分ジョグ',
        steps: ['40分'],
        rationale: '土台づくり',
        intensity: 'easy',
        alternatives: [{ when: '20分しか取れない時', what: '20分歩くだけでOK' }],
      },
      NOW,
    );
    expect(result.message).toBe('メニューを記録した');
    expect(profile.plans[0].alternatives).toHaveLength(1);
  });

  it('目標を持った瞬間は、一緒に喜ぶよう促す', () => {
    const { result } = executeTool(
      base(),
      'set_coaching_phase',
      { phase: 'goal', reason: '友人に誘われてハーフに申し込んだ' },
      NOW,
    );
    expect(String(result.message)).toContain('一緒に喜ぶ');
  });

  it('知らないツール名でも例外を投げない', () => {
    const { result } = executeTool(base(), 'delete_everything', {}, NOW);
    expect(result.ok).toBe(false);
  });
});

describe('練習データの記録', () => {
  it('読み取った計測値をカルテに残す', () => {
    const { profile } = executeTool(
      base(),
      'log_activity',
      {
        type: 'run',
        session: '閾値走',
        distanceKm: 16.1,
        durationMin: 68,
        source: 'screenshot',
        metrics: {
          avgPace: '4:14/km',
          avgHr: 168,
          maxHr: 181,
          cadence: 183,
          strideM: 1.29,
          elevationGainM: 84,
        },
      },
      NOW,
    );

    expect(profile.activities[0]).toMatchObject({
      session: '閾値走',
      source: 'screenshot',
      metrics: { avgPace: '4:14/km', avgHr: 168, cadence: 183 },
    });
  });

  it('心拍の基準値が無いまま心拍を記録したら、ゾーン評価を止める', () => {
    const { result } = executeTool(base(), 'log_activity', { type: 'run', metrics: { avgHr: 168 } }, NOW);

    expect(result.needsHrReference).toBe(true);
    expect(String(result.message)).toContain('推測せずに基準値を尋ねる');
  });

  it('最大心拍が分かっていれば、評価を止めない', () => {
    const withHr = executeTool(base(), 'update_runner_profile', { maxHr: 190 }, NOW).profile;
    const { result } = executeTool(withHr, 'log_activity', { type: 'run', metrics: { avgHr: 168 } }, NOW);

    expect(result.needsHrReference).toBe(false);
  });

  it('読み取れなかった項目は、空のまま残して埋めない', () => {
    const { profile } = executeTool(
      base(),
      'log_activity',
      { type: 'run', metrics: { avgPace: '4:14/km' } },
      NOW,
    );

    expect(profile.activities[0].metrics).toMatchObject({ avgPace: '4:14/km' });
    expect(profile.activities[0].metrics?.cadence).toBeUndefined();
    expect(profile.activities[0].metrics?.avgHr).toBeUndefined();
  });

  it('計測値が何も無ければ metrics を作らない', () => {
    const { profile } = executeTool(base(), 'log_activity', { type: 'rest' }, NOW);
    expect(profile.activities[0].metrics).toBeUndefined();
  });

  it('心拍とLTHRと故障歴をプロフィールに記録できる', () => {
    const { profile } = executeTool(
      base(),
      'update_runner_profile',
      { maxHr: 190, restingHr: 44, lthr: 172, injuryHistory: ['腸脛靭帯炎（右膝）'] },
      NOW,
    );

    expect(profile).toMatchObject({ maxHr: 190, restingHr: 44, lthr: 172 });
    expect(profile.injuryHistory).toEqual(['腸脛靭帯炎（右膝）']);
  });
});

describe('体重の記録', () => {
  it('会話から聞いた体重を残す', () => {
    const { profile, result } = executeTool(base(), 'log_weight', { weightKg: 61.42 }, NOW);

    expect(profile.bodyWeightKg).toBe(61.4);
    expect(String(result.message)).toContain('はかったこと自体を評価');
  });

  it('あり得ない値は受け取らない', () => {
    expect(executeTool(base(), 'log_weight', { weightKg: 3 }, NOW).result.ok).toBe(false);
    expect(executeTool(base(), 'log_weight', {}, NOW).result.ok).toBe(false);
  });
});
