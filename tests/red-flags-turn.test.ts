import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 危険な兆候を訴えた時の、コーチの1ターン。
 *
 * **モデルが何を書いても、「やめる」「119」は必ず届く。** ここはモデルに任せない。
 * モデルへの通信は差し替えて、ループそのものの挙動を確かめる。
 */
const generateContentStream = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContentStream };
  },
}));

import { runCoachTurn } from '@/lib/gemini';
import { activeRedFlag } from '@/lib/red-flags';
import { createDefaultProfile, type CoachState } from '@/lib/types';

const NOW = new Date('2026-09-28T09:00:00+09:00');

function reply(text: string) {
  return [{ candidates: [{ content: { parts: [{ text }] } }] }];
}

/** 呼ばれるたびに、次の応答を1つずつ返す。呼ばれた時の指示文も控える。 */
function queue(...texts: string[]) {
  let call = 0;
  const instructions: string[] = [];
  generateContentStream.mockImplementation(async (request: { config?: { systemInstruction?: unknown } }) => {
    instructions.push(String(request.config?.systemInstruction ?? ''));
    const chunks = reply(texts[Math.min(call, texts.length - 1)]);
    call += 1;
    return (async function* stream() {
      for (const chunk of chunks) yield chunk;
    })();
  });
  return instructions;
}

const state = (): CoachState => ({ profile: createDefaultProfile('u1', NOW.toISOString()), history: [] });

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key';
  generateContentStream.mockReset();
});

describe('胸の痛みを訴えた時', () => {
  it('モデルが 119 を書かなくても、先頭に必ず入る', async () => {
    queue('ケントさん、今日はゆっくり休んでくださいね。');
    const result = await runCoachTurn({ state: state(), userText: '走っていたら胸が苦しくなった', now: NOW });
    expect(result.text.startsWith('**すぐに運動をやめてください。**')).toBe(true);
    expect(result.text).toContain('119');
    // 画面に出したものと、履歴に残すものを揃える（次のターンで、自分が何を言ったか分かるように）。
    expect(JSON.stringify(result.state.history.at(-1))).toContain('119');
  });

  it('検査を通すまで一文字も流さず、まとめて1回で届ける', async () => {
    queue('少し休みましょう。');
    const deltas: string[] = [];
    const result = await runCoachTurn({
      state: state(),
      userText: '胸が痛い',
      now: NOW,
      onDelta: (delta) => deltas.push(delta),
    });
    expect(deltas).toEqual([result.text]);
  });

  it('指示文に、強制の指示が入る', async () => {
    const instructions = queue('すぐにやめて、続くなら119番へ。');
    await runCoachTurn({ state: state(), userText: '胸が締め付けられる感じがした', now: NOW });
    expect(instructions[0]).toContain('最優先・安全（例外なし）');
    expect(instructions[0]).toContain('胸の痛み');
  });

  it('走らせようとしたら、受診の方へ書き直させる', async () => {
    const instructions = queue(
      '明日は3kmをゆっくり走ってみましょう。',
      'まずは運動をやめて、続くようなら119番に電話してください。',
    );
    const result = await runCoachTurn({ state: state(), userText: '胸が苦しかった', now: NOW });
    expect(result.rewrites).toBe(1);
    expect(result.text).not.toContain('走ってみましょう');
    // 痛みの書き直し（フォームの仮説）ではなく、危険な兆候の書き直し。
    expect(instructions[1]).toContain('胸の痛み');
    expect(instructions[1]).not.toContain('フォームの仮説');
  });

  it('訴えを記録に残す（次の日以降も、診てもらうまで練習を出さない）', async () => {
    queue('すぐにやめて、続くなら119番へ。');
    const result = await runCoachTurn({ state: state(), userText: '胸が苦しい', now: NOW });
    const active = activeRedFlag(result.state.profile, new Date(NOW.getTime() + 86_400_000));
    expect(active?.record.level).toBe('emergency');
  });

  it('モデルが何も返さなくても、黙って終わらせない', async () => {
    queue('');
    const result = await runCoachTurn({ state: state(), userText: '胸が苦しい', now: NOW });
    expect(result.text).toContain('119');
  });

  /**
   * **ここが抜けやすい。** 道具を使ったターンは、本文を溜めたまま次の手順へ進む。
   * そこで本文が空で終わると、本文は空ではないので「空の時の文」にも引っかからない。
   */
  it('道具を使った後に本文が空で終わっても、安全の文が入る', async () => {
    let call = 0;
    generateContentStream.mockImplementation(async () => {
      const chunks =
        call++ === 0
          ? [
              {
                candidates: [
                  {
                    content: {
                      parts: [
                        { functionCall: { name: 'log_condition', args: { fatigue: 4 } } },
                        { text: '記録しました。' },
                      ],
                    },
                  },
                ],
              },
            ]
          : reply('');
      return (async function* stream() {
        for (const chunk of chunks) yield chunk;
      })();
    });

    const result = await runCoachTurn({ state: state(), userText: '胸が苦しい', now: NOW });
    expect(result.text).toContain('119');
    expect(result.text).toContain('記録しました。');
  });

  /** ループの中と外の両方から検査を通るので、二度足さないことを確かめる。 */
  it('決まった文言が、二重に入らない', async () => {
    queue('すぐに運動をやめてください。続く時は119番へ。');
    const result = await runCoachTurn({ state: state(), userText: '胸が苦しい', now: NOW });
    // 決まった文言が1つ、モデルが書いた文が1つ。合わせて2つまで。
    expect(result.text.match(/119/g)).toHaveLength(2);
    expect(result.text.match(/すぐに運動をやめてください/g)).toHaveLength(2);
  });
});

describe('めまい（軽い兆候）', () => {
  it('受診の話を書いていれば、そのまま出す', async () => {
    const text = '今日は運動をやめて休んでください。続くようなら循環器内科を受診しましょう。';
    queue(text);
    const result = await runCoachTurn({ state: state(), userText: '走り終わってめまいがした', now: NOW });
    expect(result.text).toBe(text);
  });

  it('受診の話が抜けていたら、足す', async () => {
    queue('今日はゆっくり休みましょう。');
    const result = await runCoachTurn({ state: state(), userText: '走り終わってめまいがした', now: NOW });
    expect(result.text).toContain('受診');
  });
});

describe('ふだんの話では、何も足さない', () => {
  it('兆候が無ければ、返答はそのまま', async () => {
    queue('いい練習でしたね。');
    const result = await runCoachTurn({ state: state(), userText: 'インターバルで息が上がった', now: NOW });
    expect(result.text).toBe('いい練習でしたね。');
    expect(result.state.profile.redFlags ?? []).toHaveLength(0);
  });
});
