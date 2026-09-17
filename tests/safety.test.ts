import { describe, expect, it } from 'vitest';
import {
  assessSafety,
  containsRunningPrescription,
  mentionsDiscomfort,
} from '@/lib/safety';
import { createBlankProfile } from '@/lib/types';
import { upsertPain } from '@/lib/profile';

const NOW = new Date('2026-09-16T09:00:00Z');

describe('assessSafety', () => {
  it('痛みが無ければ走行を止めない', () => {
    const result = assessSafety(createBlankProfile('u1'), NOW);
    expect(result.runningForbidden).toBe(false);
    expect(result.directives).toHaveLength(0);
  });

  it('痛みが1でもあれば走行を禁止し、強制指示を出す', () => {
    const profile = upsertPain(createBlankProfile('u1'), { site: '右膝の外側', severity: 1 }, NOW);
    const result = assessSafety(profile, NOW);

    expect(result.runningForbidden).toBe(true);
    expect(result.maxSeverity).toBe(1);
    expect(result.directives.join('\n')).toContain('いかなる走行メニューも提案してはならない');
  });

  it('回復傾向でも痛みが残っていれば走らせない', () => {
    const profile = upsertPain(
      createBlankProfile('u1'),
      { site: '左アキレス腱', severity: 2, status: 'improving' },
      NOW,
    );
    expect(assessSafety(profile, NOW).runningForbidden).toBe(true);
  });

  it('解消済みの痛みは制限に数えない', () => {
    const profile = upsertPain(createBlankProfile('u1'), { site: '右膝', severity: 0 }, NOW);
    expect(assessSafety(profile, NOW).runningForbidden).toBe(false);
  });

  it('記録が古い痛みには、状態を聞き直すよう促す', () => {
    const stale = upsertPain(
      createBlankProfile('u1'),
      { site: '右膝', severity: 2 },
      new Date('2026-08-01T09:00:00Z'),
    );
    const directives = assessSafety(stale, NOW).directives.join('\n');
    expect(directives).toContain('今の状態を必ず質問し');
  });
});

describe('containsRunningPrescription', () => {
  it.each([
    'まずは3kmをゆっくり走ってみましょう。',
    '今日は20分ジョグを入れてください。',
    '明日のメニューはペース走です、頑張っていきましょう。',
    '軽く流しを2本やってみませんか。',
  ])('走る指示を検知する: %s', (text) => {
    expect(containsRunningPrescription(text)).toBe(true);
  });

  it.each([
    '痛みが引くまでは走るのをやめましょう。',
    '今日はジョグはお休みにして、ストレッチだけにしましょう。',
    '走りたい気持ちはよく分かります。でも今は我慢の時です。',
    '体幹を10分だけやってみませんか。',
    'ランチの後に少し歩くだけでも十分です。',
    'バランスを意識して立ってみましょう。',
  ])('走らせていない文は誤検知しない: %s', (text) => {
    expect(containsRunningPrescription(text)).toBe(false);
  });
});

describe('mentionsDiscomfort', () => {
  it('痛みの訴えを先読みできる', () => {
    expect(mentionsDiscomfort('右膝が痛いです')).toBe(true);
    expect(mentionsDiscomfort('ふくらはぎに違和感があります')).toBe(true);
    expect(mentionsDiscomfort('今日は調子がいいです')).toBe(false);
  });
});
