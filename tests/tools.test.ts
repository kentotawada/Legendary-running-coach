import { describe, expect, it } from 'vitest';
import { coachTools, executeTool } from '@/lib/tools';
import { createEmptyProfile } from '@/lib/types';

const NOW = new Date('2026-09-16T09:00:00Z');
const base = () => createEmptyProfile('u1', NOW.toISOString());

describe('coachTools', () => {
  it('コーチが学習に使う道具が一式そろっている', () => {
    expect(coachTools.map((t) => t.name).sort()).toEqual([
      'log_activity',
      'log_condition',
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
