import { afterEach, describe, expect, it } from 'vitest';
import { buildSystemInstruction } from '@/lib/prompt';
import { createDefaultProfile } from '@/lib/types';
import { applyProfileUpdate, setPhase, upsertPain } from '@/lib/profile';
import { assessSafety } from '@/lib/safety';
import { trimHistory } from '@/lib/store';
import { cleanEnv, getBuildInfo } from '@/lib/build-info';

const NOW = new Date('2026-09-16T09:00:00Z');

describe('buildSystemInstruction', () => {
  it('痛みがある時は、走行禁止の強制指示を必ず含める', () => {
    const profile = upsertPain(createDefaultProfile('u1'), { site: '右膝', severity: 2 }, NOW);
    const prompt = buildSystemInstruction(profile, NOW);

    expect(prompt).toContain('安全のための強制指示');
    expect(prompt).toContain('いかなる走行メニューも提案してはならない');
    expect(prompt).toContain('回復最優先モード');
  });

  it('目標がある人には、逆算のロードマップを求める', () => {
    const profile = setPhase(
      applyProfileUpdate(
        createDefaultProfile('u1'),
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
    const profile = setPhase(createDefaultProfile('u1'), 'habit', '目標はないが続けたい', NOW);
    const prompt = buildSystemInstruction(profile, NOW);

    expect(prompt).toContain('習慣づくりモード');
    expect(prompt).toContain('数字とノルマは一切出さない');
  });

  it('習慣づくりから目標へ移った人には、まず一緒に喜ぶよう指示する', () => {
    const habit = setPhase(createDefaultProfile('u1'), 'habit', '今は気楽に走りたい', NOW);
    const goal = setPhase(habit, 'goal', '同僚に誘われて10kmレースに申し込んだ', NOW);
    const prompt = buildSystemInstruction(goal, NOW);

    expect(prompt).toContain('見逃してはいけない変化');
    expect(prompt).toContain('まず心から一緒に喜ぶ');
    expect(prompt).toContain('同僚に誘われて10kmレースに申し込んだ');
  });

  it('痛みは、モデルが置いたフェーズより常に優先される', () => {
    const goal = setPhase(createDefaultProfile('u1'), 'goal', 'サブスリー', NOW);
    const hurt = upsertPain(goal, { site: '足底', severity: 1 }, NOW);

    expect(buildSystemInstruction(hurt, NOW)).toContain('回復最優先モード');
  });

  it('責めない・推測しないという原則は、どのフェーズでも消えない', () => {
    for (const profile of [
      createDefaultProfile('u1'),
      setPhase(createDefaultProfile('u2'), 'habit', 'a', NOW),
      setPhase(createDefaultProfile('u3'), 'goal', 'b', NOW),
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

describe('目標に合わせて基準が変わる', () => {
  it('新しいランナーには目標を決めつけない', () => {
    const profile = createDefaultProfile('u1', NOW.toISOString());

    expect(profile.goal).toBeUndefined();
    expect(profile.phase).toBe('unknown');
    expect(profile.injuryHistory).toBeUndefined();
  });

  it('目標が決まるまでは、ペース基準を出させない', () => {
    const prompt = buildSystemInstruction(createDefaultProfile('u1', NOW.toISOString()), NOW);
    expect(prompt).toContain('ペース基準を出す前に、まず目標を尋ねること');
  });

  it('申告された故障歴は「過去のもの」であって、走行を禁止しない', () => {
    // ここを取り違えると、痛みが無いのに永遠に走らせないコーチになる。
    const profile = applyProfileUpdate(
      createDefaultProfile('u1', NOW.toISOString()),
      { injuryHistory: ['膝の痛み（2年前）'] },
      NOW,
    );
    const safety = assessSafety(profile, NOW);

    expect(safety.runningForbidden).toBe(false);
    expect(buildSystemInstruction(profile, NOW)).not.toContain('回復最優先モード');
  });

  it('カルテには故障歴が残り、負荷を上げる時の判断材料になる', () => {
    const profile = applyProfileUpdate(
      createDefaultProfile('u1', NOW.toISOString()),
      { injuryHistory: ['右腸脛靭帯炎'] },
      NOW,
    );
    const prompt = buildSystemInstruction(profile, NOW);

    expect(prompt).toContain('故障歴');
    expect(prompt).toContain('右腸脛靭帯炎');
  });

  it('レベルに依らない原則は、常にコーチが持っている', () => {
    const prompt = buildSystemInstruction(createDefaultProfile('u1', NOW.toISOString()), NOW);

    expect(prompt).toContain('週の8割はイージー');
    expect(prompt).toContain('180spm');
    expect(prompt).toContain('オーバーストライド');
    expect(prompt).toContain('前週比10%以内');
  });

  it('基準の数字は、その人の目標に合わせて切り替わる', () => {
    const sub3 = applyProfileUpdate(
      createDefaultProfile('u1', NOW.toISOString()),
      { goal: { kind: 'time', summary: 'サブ3', targetTime: '2:59:59' } },
      NOW,
    );
    const sub4 = applyProfileUpdate(
      createDefaultProfile('u2', NOW.toISOString()),
      { goal: { kind: 'time', summary: 'サブ4', targetTime: '3:59:59' } },
      NOW,
    );

    expect(buildSystemInstruction(sub3, NOW)).toContain('4:15/km');
    expect(buildSystemInstruction(sub4, NOW)).toContain('5:41/km');
    // 分析の観点そのものは、どちらでも変わらない。
    for (const profile of [sub3, sub4]) {
      expect(buildSystemInstruction(profile, NOW)).toContain('週の8割はイージー');
    }
  });

  it('心拍の基準値が無ければゾーン評価をさせず、尋ねさせる', () => {
    const prompt = buildSystemInstruction(createDefaultProfile('u1', NOW.toISOString()), NOW);

    expect(prompt).toContain('推測した心拍で語ってはならない');
    expect(prompt).toContain('220−年齢');
  });

  it('最大心拍だけでも、計算済みのゾーンをコーチに渡す', () => {
    const profile = applyProfileUpdate(createDefaultProfile('u1', NOW.toISOString()), { maxHr: 190 }, NOW);
    const prompt = buildSystemInstruction(profile, NOW);

    // LTHR も安静時も空欄だが、止まらずにゾーンが出ている。
    expect(prompt).toContain('Z2 イージー: 124〜142 bpm');
    expect(prompt).toContain('空欄を理由に「分かりません」で終わらせない');
    expect(prompt).toContain('推定値');
  });

  it('LTHR まで分かっていれば、そちらを基準にする', () => {
    const profile = applyProfileUpdate(
      createDefaultProfile('u1', NOW.toISOString()),
      { maxHr: 190, lthr: 172 },
      NOW,
    );
    expect(buildSystemInstruction(profile, NOW)).toContain('LTHR 172 bpm を基準に算出');
  });

  it('メニューとゾーンをカードで出す書き方を指示している', () => {
    const prompt = buildSystemInstruction(createDefaultProfile('u1', NOW.toISOString()), NOW);

    expect(prompt).toContain('```menu');
    expect(prompt).toContain('```zones');
    expect(prompt).toContain('表（|）は使わない');
    expect(prompt).toContain('アスタリスクは画面に出ず');
  });

  it('画像からは、読み取れなかった項目を推測で埋めさせない', () => {
    const prompt = buildSystemInstruction(createDefaultProfile('u1', NOW.toISOString()), NOW);

    expect(prompt).toContain('絶対に推測で埋めないでください');
    expect(prompt).toContain('今日の練習の質');
    expect(prompt).toContain('疲労度');
    expect(prompt).toContain('次回の練習提案');
  });

  it('シリアス向けになっても、痛みと生活への配慮は消えない', () => {
    const prompt = buildSystemInstruction(createDefaultProfile('u1', NOW.toISOString()), NOW);

    expect(prompt).toContain('決して責めない');
    expect(prompt).toContain('勝手に推測しない');
    expect(prompt).toContain('走行メニューは一切出さない');
  });
});

describe('ツール呼び出しの扱い', () => {
  it('ツール名やJSONを本文に書かせない', () => {
    const prompt = buildSystemInstruction(createDefaultProfile('u1', NOW.toISOString()), NOW);

    expect(prompt).toContain('ツールは必ずツール呼び出しとして実行すること');
    expect(prompt).toContain('返答の本文に書いてはなりません');
  });
});

describe('APIキーの形式チェック', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('接頭辞が違っても、まともな長さのキーなら警告しない', () => {
    // 形式は提供側の都合で変わる。動いているキーに警告を出さないため。
    process.env.GEMINI_API_KEY = 'ya29-some-other-shape-but-valid-key-0123456789';
    expect(getBuildInfo().apiKeyLooksValid).toBe(true);
  });

  it('空白の混入と短すぎる値は見つける', () => {
    process.env.GEMINI_API_KEY = 'AIza with space 0123456789012345678';
    expect(getBuildInfo().apiKeyLooksValid).toBe(false);

    process.env.GEMINI_API_KEY = 'short';
    expect(getBuildInfo().apiKeyLooksValid).toBe(false);
  });
});
