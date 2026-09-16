import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Gemini への通信は差し替え、エージェントループそのものの挙動を確かめる。 */
const generateContentStream = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContentStream };
  },
}));

import { runCoachTurn } from '@/lib/gemini';
import { createEmptyProfile } from '@/lib/types';
import { upsertPain } from '@/lib/profile';
import type { CoachState } from '@/lib/types';

const NOW = new Date('2026-09-16T09:00:00Z');

type FakePart = Record<string, unknown>;

function chunksOf(...groups: FakePart[][]) {
  return groups.map((parts) => ({ candidates: [{ content: { parts } }] }));
}

/** 呼ばれるたびに、次の応答を1つずつ返す。 */
function queueResponses(...responses: ReturnType<typeof chunksOf>[]) {
  let call = 0;
  generateContentStream.mockImplementation(async () => {
    const chunks = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return (async function* stream() {
      for (const chunk of chunks) yield chunk;
    })();
  });
}

function stateOf(profile = createEmptyProfile('u1', NOW.toISOString())): CoachState {
  return { profile, history: [] };
}

describe('runCoachTurn', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    generateContentStream.mockReset();
  });

  it('本文を少しずつ流しながら、履歴に積む', async () => {
    queueResponses(chunksOf([{ text: 'おかえり' }], [{ text: 'なさい！' }]));
    const deltas: string[] = [];

    const result = await runCoachTurn({
      state: stateOf(),
      userText: '走ってきました',
      now: NOW,
      onDelta: (d) => deltas.push(d),
    });

    expect(deltas).toEqual(['おかえり', 'なさい！']);
    expect(result.text).toBe('おかえりなさい！');
    expect(result.state.history.at(-1)).toMatchObject({ role: 'model' });
  });

  it('ツール呼び出しを実行し、結果を返してから本文を書かせる', async () => {
    queueResponses(
      chunksOf([{ functionCall: { name: 'log_activity', args: { type: 'run', distanceKm: 5 } } }]),
      chunksOf([{ text: '5km、よく走りましたね！' }]),
    );

    const result = await runCoachTurn({ state: stateOf(), userText: '5km走りました', now: NOW });

    expect(result.usedTools).toEqual(['log_activity']);
    expect(result.state.profile.activities[0]).toMatchObject({ type: 'run', distanceKm: 5 });
    // モデルの発言 → functionResponse → モデルの発言、の順で履歴が積まれている。
    expect(result.state.history.map((c) => c.role)).toEqual(['user', 'model', 'user', 'model']);
    expect(result.state.history[2].parts?.[0].functionResponse?.name).toBe('log_activity');
  });

  it('モデルの思考パートの署名を落とさずに履歴へ戻す', async () => {
    queueResponses(chunksOf([{ text: '考え中', thought: true, thoughtSignature: 'sig-1' }, { text: 'こんにちは' }]));

    const result = await runCoachTurn({ state: stateOf(), userText: 'はじめまして', now: NOW });
    const modelParts = result.state.history.at(-1)?.parts ?? [];

    expect(modelParts[0]).toMatchObject({ thought: true, thoughtSignature: 'sig-1' });
    expect(result.text).toBe('こんにちは');
  });

  it('痛みがある時は、検査を通すまで一文字も画面に流さない', async () => {
    queueResponses(chunksOf([{ text: '無理のない範囲で、体幹を10分だけやってみませんか。' }]));
    const deltas: string[] = [];
    const hurt = upsertPain(createEmptyProfile('u1', NOW.toISOString()), { site: '右膝', severity: 3 }, NOW);

    const result = await runCoachTurn({
      state: stateOf(hurt),
      userText: '今日はどうすればいいですか',
      now: NOW,
      onDelta: (d) => deltas.push(d),
    });

    // 分割送信ではなく、検査後に一括で届く。
    expect(deltas).toEqual([result.text]);
    expect(result.rewrites).toBe(0);
  });

  it('痛みがあるのに走らせようとしたら、書き直させてから届ける', async () => {
    queueResponses(
      chunksOf([{ text: 'まずは3kmをゆっくり走ってみましょう。' }]),
      chunksOf([{ text: '今は走らず、痛みの出ない範囲で体幹を整えましょう。' }]),
    );
    const deltas: string[] = [];
    const hurt = upsertPain(createEmptyProfile('u1', NOW.toISOString()), { site: '右膝', severity: 3 }, NOW);

    const result = await runCoachTurn({
      state: stateOf(hurt),
      userText: '今日は何をすればいいですか',
      now: NOW,
      onDelta: (d) => deltas.push(d),
    });

    expect(result.rewrites).toBe(1);
    expect(result.text).toBe('今は走らず、痛みの出ない範囲で体幹を整えましょう。');
    expect(deltas.join('')).not.toContain('走ってみましょう');
    // 却下した発言は履歴にも残さない。
    expect(JSON.stringify(result.state.history)).not.toContain('3kmをゆっくり');
  });

  it('痛みを訴えた発言は、カルテ更新前でも慎重モードに入る', async () => {
    queueResponses(
      chunksOf([{ functionCall: { name: 'update_pain', args: { site: '右膝', severity: 3 } } }]),
      chunksOf([{ text: 'まずは軽く走ってみましょう。' }]),
      chunksOf([{ text: '走るのは一旦お休みにして、痛みの様子を詳しく教えてください。' }]),
    );
    const deltas: string[] = [];

    const result = await runCoachTurn({
      state: stateOf(),
      userText: '右膝が痛いです',
      now: NOW,
      onDelta: (d) => deltas.push(d),
    });

    expect(result.rewrites).toBe(1);
    expect(deltas.join('')).not.toContain('軽く走って');
  });

  it('本文もツール呼び出しも返らない時は、会話を止めずに聞き直す', async () => {
    queueResponses(chunksOf([]));
    const result = await runCoachTurn({ state: stateOf(), userText: 'こんにちは', now: NOW });

    expect(result.text).toContain('もう一度');
    expect(result.state.history.at(-1)?.role).toBe('model');
  });

  it('API キーが無ければ、その理由がはっきり分かる形で失敗する', async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(runCoachTurn({ state: stateOf(), userText: 'やあ', now: NOW })).rejects.toThrow(
      /GEMINI_API_KEY/,
    );
  });
});
