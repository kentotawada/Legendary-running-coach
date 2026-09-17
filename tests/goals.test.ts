import { describe, expect, it } from 'vitest';
import {
  GOAL_PRESETS,
  formatPace,
  goalDoctrine,
  marathonPaceSeconds,
  parseDuration,
  resolveTargetPace,
  trainingPaces,
  volumeGuide,
} from '@/lib/goals';
import { createDefaultProfile } from '@/lib/types';
import { applyProfileUpdate } from '@/lib/profile';

const NOW = new Date('2026-09-17T09:00:00Z');

describe('parseDuration', () => {
  it('時:分:秒 と 分:秒 を読む', () => {
    expect(parseDuration('2:59:59')).toBe(10799);
    expect(parseDuration('29:30')).toBe(1770);
  });

  it('読めない値は undefined を返す', () => {
    for (const value of ['', 'abc', '1:2:3:4', '1:75:00', undefined]) {
      expect(parseDuration(value)).toBeUndefined();
    }
  });
});

describe('目標タイムからペースを導く', () => {
  it('必要ペースは速い側に丸める（そのまま走って目標を外さないように）', () => {
    // 3時間切りに必要なのは 4:15.9/km。4:16 で走ると 3:00:21 になってしまう。
    expect(formatPace(255.95)).toBe('4:15/km');
  });

  it.each([
    ['2:59:59', '4:15/km'],
    ['3:29:59', '4:58/km'],
    ['3:59:59', '5:41/km'],
    ['4:29:59', '6:23/km'],
    ['4:59:59', '7:06/km'],
  ])('%s の必要ペースは %s', (time, pace) => {
    expect(formatPace(marathonPaceSeconds(time) as number)).toBe(pace);
  });
});

describe('trainingPaces', () => {
  it('サブ3の基準を導ける', () => {
    const paces = trainingPaces(marathonPaceSeconds('2:59:59') as number);

    expect(paces.marathon).toBe('4:15/km');
    expect(paces.threshold).toBe('4:04/km');
    expect(paces.interval).toBe('3:46/km');
    expect(paces.easyFrom).toBe('5:19/km');
  });

  it('サブ4でも同じ理屈で基準が出る', () => {
    const paces = trainingPaces(marathonPaceSeconds('3:59:59') as number);

    expect(paces.marathon).toBe('5:41/km');
    // どのレベルでも、閾値はレースペースより速く、イージーは遅い。
    expect(paces.threshold < paces.marathon).toBe(true);
    expect(paces.easyFrom > paces.marathon).toBe(true);
  });
});

describe('volumeGuide', () => {
  it('目標が速いほど、求める距離が増える', () => {
    expect(volumeGuide({ kind: 'time', summary: '', targetTime: '2:59:59' }).weeklyKm).toContain('60〜80');
    expect(volumeGuide({ kind: 'time', summary: '', targetTime: '3:59:59' }).weeklyKm).toContain('40〜55');
    expect(volumeGuide({ kind: 'time', summary: '', targetTime: '4:59:59' }).weeklyKm).toContain('30〜40');
  });

  it('健康維持には距離のノルマを置かない', () => {
    expect(volumeGuide({ kind: 'health', summary: '' }).weeklyKm).toContain('ノルマは置かない');
  });
});

describe('goalDoctrine', () => {
  const withGoal = (targetTime: string, summary = 'テスト目標') =>
    applyProfileUpdate(createDefaultProfile('u1'), { goal: { kind: 'time', summary, targetTime } }, NOW);

  it('目標が未設定なら、数字を出す前に尋ねさせる', () => {
    const text = goalDoctrine(createDefaultProfile('u1'));

    expect(text).toContain('ペース基準を出す前に、まず目標を尋ねること');
    expect(text).toContain('カルテ');
  });

  it('サブ4の人にはサブ4の基準を渡す', () => {
    const text = goalDoctrine(withGoal('3:59:59'));

    expect(text).toContain('5:41/km');
    expect(text).toContain('週40〜55km');
    expect(text).not.toContain('4:15/km');
  });

  it('サブ3の人にはサブ3の基準を渡す', () => {
    const text = goalDoctrine(withGoal('2:59:59'));

    expect(text).toContain('4:15/km');
    expect(text).toContain('週60〜80km');
  });

  it('手動で設定した目標ペースが、計算値より優先される', () => {
    const profile = applyProfileUpdate(
      createDefaultProfile('u1'),
      { goal: { kind: 'time', summary: 'X', targetTime: '3:59:59', targetPace: '5:30/km' } },
      NOW,
    );

    expect(goalDoctrine(profile)).toContain('5:30/km');
    expect(resolveTargetPace(profile.goal)).toBe('5:30/km');
  });

  it('完走目標なら、ペースではなく動き続けられる時間で見る', () => {
    const profile = applyProfileUpdate(
      createDefaultProfile('u1'),
      { goal: { kind: 'race', summary: '初フル完走' } },
      NOW,
    );

    expect(goalDoctrine(profile)).toContain('止まらずに動き続けられる時間');
  });

  it('健康維持なら、タイムとノルマを前面に出させない', () => {
    const profile = applyProfileUpdate(
      createDefaultProfile('u1'),
      { goal: { kind: 'health', summary: '健康維持' } },
      NOW,
    );

    expect(goalDoctrine(profile)).toContain('タイムとノルマを前面に出さない');
  });

  it('用意したプリセットは、すべて基準を出せる形になっている', () => {
    for (const preset of GOAL_PRESETS) {
      if (!preset.targetTime) continue;
      expect(marathonPaceSeconds(preset.targetTime)).toBeGreaterThan(0);
    }
  });
});
