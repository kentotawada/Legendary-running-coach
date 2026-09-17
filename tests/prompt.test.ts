import { afterEach, describe, expect, it } from 'vitest';
import { buildSystemInstruction } from '@/lib/prompt';
import { createEmptyProfile } from '@/lib/types';
import { applyProfileUpdate, setPhase, upsertPain } from '@/lib/profile';
import { trimHistory } from '@/lib/store';
import { cleanEnv, getBuildInfo } from '@/lib/build-info';

const NOW = new Date('2026-09-16T09:00:00Z');

describe('buildSystemInstruction', () => {
  it('痛みがある時は、走行禁止の強制指示を必ず含める', () => {
    const profile = upsertPain(createEmptyProfile('u1'), { site: '右膝', severity: 2 }, NOW);
    const prompt = buildSystemInstruction(profile, NOW);

    expect(prompt).toContain('安全のための強制指示');
    expect(prompt).toContain('いかなる走行メニューも提案してはならない');
    expect(prompt).toContain('回復最優先モード');
  });

  it('目標がある人には、逆算のロードマップを求める', () => {
    const profile = setPhase(
      applyProfileUpdate(
        createEmptyProfile('u1'),
        { goal: { kind: 'time', summary: 'サブスリー', raceDate: '2027-02-28' } },
        NOW,
      ),
      'goal',
      'サブスリーを狙うと決めた',
      NOW,
    );
    const prompt = buildSystemInstruction(profile, NOW);

    expect(prompt).toContain('目標達成モード');
    expect(prompt).toContain('逆算');
    expect(prompt).toContain('計画の遵守よりその日のコンディションが常に優先');
  });

  it('習慣づくりの人には、数字とノルマを禁じる', () => {
    const profile = setPhase(createEmptyProfile('u1'), 'habit', '目標はないが続けたい', NOW);
    const prompt = buildSystemInstruction(profile, NOW);

    expect(prompt).toContain('習慣づくりモード');
    expect(prompt).toContain('数字とノルマは一切出さない');
  });

  it('習慣づくりから目標へ移った人には、まず一緒に喜ぶよう指示する', () => {
    const habit = setPhase(createEmptyProfile('u1'), 'habit', '今は気楽に走りたい', NOW);
    const goal = setPhase(habit, 'goal', '同僚に誘われて10kmレースに申し込んだ', NOW);
    const prompt = buildSystemInstruction(goal, NOW);

    expect(prompt).toContain('見逃してはいけない変化');
    expect(prompt).toContain('まず心から一緒に喜ぶ');
    expect(prompt).toContain('同僚に誘われて10kmレースに申し込んだ');
  });

  it('痛みは、モデルが置いたフェーズより常に優先される', () => {
    const goal = setPhase(createEmptyProfile('u1'), 'goal', 'サブスリー', NOW);
    const hurt = upsertPain(goal, { site: '足底', severity: 1 }, NOW);

    expect(buildSystemInstruction(hurt, NOW)).toContain('回復最優先モード');
  });

  it('責めない・推測しないという原則は、どのフェーズでも消えない', () => {
    for (const profile of [
      createEmptyProfile('u1'),
      setPhase(createEmptyProfile('u2'), 'habit', 'a', NOW),
      setPhase(createEmptyProfile('u3'), 'goal', 'b', NOW),
    ]) {
      const prompt = buildSystemInstruction(profile, NOW);
      expect(prompt).toContain('決して責めない');
      expect(prompt).toContain('勝手に推測しない');
      expect(prompt).toContain('一言を添える');
    }
  });
});

describe('trimHistory', () => {
  it('上限を超えたら、ユーザー発言の切れ目まで戻して切る', () => {
    const history = [
      { role: 'user', parts: [{ text: '1' }] },
      { role: 'model', parts: [{ functionCall: { name: 'log_condition', args: {} } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'log_condition', response: {} } }] },
      { role: 'model', parts: [{ text: '2' }] },
      { role: 'user', parts: [{ text: '3' }] },
      { role: 'model', parts: [{ text: '4' }] },
    ];

    const trimmed = trimHistory(history, 3);
    expect(trimmed[0].role).toBe('user');
    expect(trimmed.length).toBeLessThanOrEqual(3);
  });

  it('上限内ならそのまま返す', () => {
    const history = [{ role: 'user', parts: [{ text: 'a' }] }];
    expect(trimHistory(history, 10)).toBe(history);
  });
});

describe('cleanEnv', () => {
  it('引用符や空白ごと貼り付けられた環境変数を救う', () => {
    expect(cleanEnv('"AIzaSyABC"')).toBe('AIzaSyABC');
    expect(cleanEnv("  'AIzaSyABC'  ")).toBe('AIzaSyABC');
    expect(cleanEnv('AIzaSyABC\n')).toBe('AIzaSyABC');
    expect(cleanEnv(undefined)).toBe('');
  });
});

describe('getBuildInfo', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('キーの値は絶対に返さず、状態だけを返す', () => {
    process.env.GEMINI_API_KEY = 'AIzaSy0123456789012345678901234567890';
    const info = getBuildInfo();

    expect(JSON.stringify(info)).not.toContain('AIzaSy0123456789012345678901234567890');
    expect(info.hasApiKey).toBe(true);
    expect(info.apiKeyLooksValid).toBe(true);
  });

  it('形の壊れたキーを設定ミスとして見分ける', () => {
    process.env.GEMINI_API_KEY = 'your-api-key-here';
    expect(getBuildInfo().apiKeyLooksValid).toBe(false);
  });

  it('コミットが分からない場合は local と答える', () => {
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.COACH_COMMIT_SHA;
    expect(getBuildInfo().commit).toBe('local');
  });
});
