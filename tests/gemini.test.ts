import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Gemini への通信は差し替え、エージェントループそのものの挙動を確かめる。 */
const generateContentStream = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContentStream };
  },
}));

import { CoachApiError, describeGeminiError, runCoachTurn } from '@/lib/gemini';
import { createDefaultProfile } from '@/lib/types';
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

function stateOf(profile = createDefaultProfile('u1', NOW.toISOString())): CoachState {
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
    const hurt = upsertPain(createDefaultProfile('u1', NOW.toISOString()), { site: '右膝', severity: 3 }, NOW);

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
    const hurt = upsertPain(createDefaultProfile('u1', NOW.toISOString()), { site: '右膝', severity: 3 }, NOW);

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

function apiError(message: string, status?: number): Error {
  return Object.assign(new Error(message), status === undefined ? {} : { status });
}

describe('describeGeminiError', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
  });

  it('キーが無効なら、キーを作り直せと言う', () => {
    const error = describeGeminiError(apiError('API key not valid. Please pass a valid API key.', 400), 'm');
    expect(error.message).toContain('GEMINI_API_KEY が無効です');
  });

  it('権限エラーなら、キーの制限と API の有効化を疑わせる', () => {
    const error = describeGeminiError(apiError('PERMISSION_DENIED', 403), 'm');
    expect(error.message).toContain('制限');
  });

  it('モデルが無ければ、差し替え先を具体的に示す', () => {
    const error = describeGeminiError(apiError('models/foo is not found', 404), 'foo');
    expect(error.message).toContain('モデル「foo」');
    expect(error.message).toContain('GEMINI_MODEL');
  });

  it('レート制限とサーバー側の不調を区別する', () => {
    expect(describeGeminiError(apiError('RESOURCE_EXHAUSTED', 429), 'm').message).toContain('利用上限');
    expect(describeGeminiError(apiError('internal', 503), 'm').message).toContain('一時的な問題');
  });

  it('メッセージに API キーが混ざっていても外へ出さない', () => {
    const error = describeGeminiError(apiError('bad key AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'), 'm');
    expect(error.detail).not.toContain('AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q');
    expect(error.detail).toContain('AIza***');
  });

  it('翻訳済みのエラーは二重に包まない', () => {
    const original = new CoachApiError('もう訳してある', 'detail');
    expect(describeGeminiError(original, 'm')).toBe(original);
  });
});

describe('モデルの退避', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    delete process.env.GEMINI_MODEL;
    generateContentStream.mockReset();
  });

  it('既定のモデルが使えなければ、退避先のモデルで続行する', async () => {
    generateContentStream.mockImplementation(async ({ model }: { model: string }) => {
      if (model === 'gemini-3-pro-preview') throw apiError('models/gemini-3-pro-preview is not found', 404);
      return (async function* stream() {
        for (const chunk of chunksOf([{ text: 'こんにちは！' }])) yield chunk;
      })();
    });

    const result = await runCoachTurn({ state: stateOf(), userText: 'やあ', now: NOW });

    expect(result.text).toBe('こんにちは！');
    expect(generateContentStream.mock.calls.map((c) => c[0].model)).toEqual([
      'gemini-3-pro-preview',
      'gemini-3-flash-preview',
    ]);
  });

  it('上位モデルの割り当てが無い(429)時も、軽いモデルで一度試す', async () => {
    generateContentStream.mockImplementation(async ({ model }: { model: string }) => {
      if (model === 'gemini-3-pro-preview') throw apiError('RESOURCE_EXHAUSTED', 429);
      return (async function* stream() {
        for (const chunk of chunksOf([{ text: 'いけました' }])) yield chunk;
      })();
    });

    const result = await runCoachTurn({ state: stateOf(), userText: 'やあ', now: NOW });
    expect(result.text).toBe('いけました');
  });

  it('退避先も駄目なら、最後のエラーの理由をそのまま伝える', async () => {
    generateContentStream.mockImplementation(async () => {
      throw apiError('RESOURCE_EXHAUSTED', 429);
    });

    await expect(runCoachTurn({ state: stateOf(), userText: 'やあ', now: NOW })).rejects.toThrow(
      /利用上限/,
    );
    expect(generateContentStream).toHaveBeenCalledTimes(2);
  });

  it('モデルの問題でなければ退避せず、理由を持って失敗する', async () => {
    generateContentStream.mockImplementation(async () => {
      throw apiError('API key not valid', 400);
    });

    await expect(runCoachTurn({ state: stateOf(), userText: 'やあ', now: NOW })).rejects.toThrow(
      /GEMINI_API_KEY が無効です/,
    );
    expect(generateContentStream).toHaveBeenCalledTimes(1);
  });
});

describe('画像つきのターン', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    delete process.env.GEMINI_MODEL;
    generateContentStream.mockReset();
  });

  it('画像をテキストより先に置いてモデルへ渡す', async () => {
    queueResponses(chunksOf([{ text: '16.1km、平均4:14。狙いどおりです。' }]));

    await runCoachTurn({
      state: stateOf(),
      userText: '今日の閾値走です',
      images: [{ mimeType: 'image/jpeg', data: 'BASE64DATA' }],
      now: NOW,
    });

    // contents はループ中に追記される同じ配列なので、最初のユーザー発言を直接見る。
    const sent = generateContentStream.mock.calls[0][0].contents;
    const parts = sent[0].parts;
    expect(parts[0].inlineData).toMatchObject({ mimeType: 'image/jpeg', data: 'BASE64DATA' });
    expect(parts[1].text).toBe('今日の閾値走です');
  });

  it('保存する履歴に画像データを残さない', async () => {
    queueResponses(chunksOf([{ text: '読み取りました。' }]));

    const result = await runCoachTurn({
      state: stateOf(),
      userText: '見てください',
      images: [{ mimeType: 'image/jpeg', data: 'SHOULDNOTPERSIST' }],
      now: NOW,
    });

    expect(JSON.stringify(result.state.history)).not.toContain('SHOULDNOTPERSIST');
    expect(JSON.stringify(result.state.history)).toContain('画像が1枚');
  });

  it('画像から読み取った値は、ツール経由でカルテに入る', async () => {
    queueResponses(
      chunksOf([
        {
          functionCall: {
            name: 'log_activity',
            args: {
              type: 'run',
              session: '閾値走',
              distanceKm: 16.1,
              source: 'screenshot',
              metrics: { avgPace: '4:14/km', avgHr: 168, cadence: 183 },
            },
          },
        },
      ]),
      chunksOf([{ text: '平均4:14でこの心拍なら、閾値として成立しています。' }]),
    );

    const result = await runCoachTurn({
      state: stateOf(),
      userText: '',
      images: [{ mimeType: 'image/jpeg', data: 'X' }],
      now: NOW,
    });

    expect(result.state.profile.activities[0]).toMatchObject({
      session: '閾値走',
      source: 'screenshot',
      metrics: { avgPace: '4:14/km', cadence: 183 },
    });
  });
});
