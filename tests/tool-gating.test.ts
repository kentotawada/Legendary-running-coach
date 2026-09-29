import { describe, expect, it } from 'vitest';
import { coachTools, executeTool, toolsFor } from '@/lib/tools';
import { createDefaultProfile } from '@/lib/types';

/**
 * 使いようのない道具は、毎回送らない。
 *
 * **道具の説明は呼び出しごとにまるごと買い直している。**
 * 大会を1つも登録していない人に「大会を消す道具」の説明を送る意味は無いし、
 * 選べない道具が並んでいること自体が、モデルの迷いにもなる。
 */

const NOW = new Date('2026-09-29T09:00:00Z');
const base = () => createDefaultProfile('u1', NOW.toISOString());
const names = (profile: Parameters<typeof toolsFor>[0]) =>
  toolsFor(profile, NOW).map((t) => t.name ?? '');

describe('状態で、道具を出し分ける', () => {
  it('まっさらな人には、使いようのない4つを出さない', () => {
    const out = names(base());
    for (const gone of ['clear_red_flag', 'remove_race', 'retire_shoes', 'log_gear_feedback']) {
      expect(out, gone).not.toContain(gone);
    }
  });

  /** **記録する道具は、いつでも出す。** 無いから足せない、では詰む。 */
  it('記録するための道具は、いつでも出す', () => {
    const out = names(base());
    for (const kept of [
      'log_activity',
      'log_condition',
      'update_pain',
      'set_today_plan',
      'update_runner_profile',
      'add_race',
      'add_shoes',
      'log_weight',
      'find_gear',
      'set_coaching_phase',
    ]) {
      expect(out, kept).toContain(kept);
    }
  });

  it('大会を登録したら、消す道具が出る', () => {
    const withRace = executeTool(
      base(),
      'add_race',
      { name: '大阪マラソン', date: '2027-02-28', distance: 'marathon', priority: 'A' },
      NOW,
    ).profile;
    expect(names(base())).not.toContain('remove_race');
    expect(names(withRace)).toContain('remove_race');
  });

  it('靴を登録したら、引退させる道具と、合う合わないを記録する道具が出る', () => {
    const withShoes = executeTool(
      base(),
      'add_shoes',
      { name: 'ペガサス 41', role: 'daily' },
      NOW,
    ).profile;
    expect(names(withShoes)).toContain('retire_shoes');
    expect(names(withShoes)).toContain('log_gear_feedback');
  });

  /** 危険な兆候が出ている間だけ、それを解除する道具を渡す。 */
  it('危険な兆候が出たら、解除する道具が出る', () => {
    const { profile } = executeTool(base(), 'log_condition', { fatigue: 3 }, NOW);
    expect(names(profile)).not.toContain('clear_red_flag');

    const flagged = {
      ...profile,
      redFlags: [{ signs: ['胸の痛み'], level: 'emergency' as const, at: NOW.toISOString() }],
    };
    expect(names(flagged)).toContain('clear_red_flag');
  });

  it('出し分けても、道具そのものは作り変えない', () => {
    const out = toolsFor(base(), NOW);
    for (const tool of out) {
      expect(coachTools).toContain(tool);
    }
  });

  it('どれだけ軽くなるか', () => {
    const full = JSON.stringify(coachTools).length;
    const trimmed = JSON.stringify(toolsFor(base(), NOW)).length;
    expect(trimmed).toBeLessThan(full);
    // 使い始めの人ほど、落とせるものが多い。
    expect(full - trimmed).toBeGreaterThan(1_000);
  });
});
