import { describe, expect, it } from 'vitest';
import { compactHistory, repairHistory, trimHistory } from '@/lib/store';
import type { TimedContent } from '@/lib/types';

/**
 * 壊れた履歴を、送る前に繕う。
 *
 * **壊れた履歴は、その人の会話を永久に止める。**
 * Gemini は「結果は呼び出しの直後に来ること」を求める。片方だけが残っていると
 * 400 で弾かれ、保存まで進まないので直る機会も来ない。次も、その次も同じ所で落ちる。
 *
 * 実際にそうなった。切り詰めが「呼び出しの無い結果」を先頭に残していて、
 * その人は何度送っても同じエラーしか返らない状態だった。
 */

const user = (text: string): TimedContent => ({ role: 'user', parts: [{ text }] });
const model = (text: string): TimedContent => ({ role: 'model', parts: [{ text }] });
const call = (name: string): TimedContent => ({
  role: 'model',
  parts: [{ functionCall: { name, args: { distanceKm: 10 } } }],
});
const result = (name: string): TimedContent => ({
  role: 'user',
  parts: [{ functionResponse: { name, response: { ok: true } } }],
});

/** Gemini が求める形になっているか。結果は、呼び出しの直後にだけ許される。 */
function pairsAreSound(history: TimedContent[]): boolean {
  for (let i = 0; i < history.length; i += 1) {
    const parts = history[i].parts ?? [];
    if (parts.some((p) => p.functionResponse)) {
      const previous = history[i - 1]?.parts ?? [];
      if (!previous.some((p) => p.functionCall)) return false;
    }
    if (parts.some((p) => p.functionCall)) {
      const next = history[i + 1]?.parts ?? [];
      if (!next.some((p) => p.functionResponse)) return false;
    }
  }
  return true;
}

const texts = (history: TimedContent[]) =>
  history.flatMap((c) => (c.parts ?? []).map((p) => p.text).filter(Boolean));

describe('片方だけ残った対を落とす', () => {
  /** **これが実際に起きた形。** 先頭に、呼び出しの無い結果だけが残っていた。 */
  it('呼び出しの無い結果は落とす', () => {
    const broken = [result('log_activity'), model('記録しました'), user('ありがとう')];
    const fixed = repairHistory(broken);

    expect(pairsAreSound(fixed)).toBe(true);
    expect(texts(fixed)).toEqual(['記録しました', 'ありがとう']);
  });

  it('結果の来ない呼び出しも落とす', () => {
    const broken = [user('走りました'), call('log_activity')];
    expect(pairsAreSound(repairHistory(broken))).toBe(true);
  });

  /** **人が話した言葉には触らない。** 落とすのは片割れだけ。 */
  it('同じ turn の本文は残す', () => {
    const mixed: TimedContent[] = [
      { role: 'model', parts: [{ text: '記録しますね' }, { functionCall: { name: 'log_activity', args: {} } }] },
      model('終わりました'),
    ];
    const fixed = repairHistory(mixed);
    expect(texts(fixed)).toEqual(['記録しますね', '終わりました']);
    expect(pairsAreSound(fixed)).toBe(true);
  });

  it('そろっている対は、そのまま通す', () => {
    const sound = [user('走りました'), call('log_activity'), result('log_activity'), model('お疲れさま')];
    expect(repairHistory(sound)).toEqual(sound);
  });

  it('繕ったあとに、空になった turn を残さない', () => {
    for (const content of repairHistory([result('log_activity'), user('やあ')])) {
      expect((content.parts ?? []).length).toBeGreaterThan(0);
    }
  });

  /** 落とした結果、後ろの対の隣が変わる。順に見ていくことで辻褄を合わせる。 */
  it('連鎖しても、最後まで整う', () => {
    const broken = [
      result('log_activity'),
      result('log_condition'),
      call('log_weight'),
      user('やあ'),
      call('log_activity'),
      result('log_activity'),
      model('はい'),
    ];
    const fixed = repairHistory(broken);
    expect(pairsAreSound(fixed)).toBe(true);
    expect(texts(fixed)).toContain('やあ');
    expect(texts(fixed)).toContain('はい');
  });

  it('何もしなくてよい履歴は、作り直さない', () => {
    const plain = [user('やあ'), model('こんにちは')];
    expect(repairHistory(plain)).toEqual(plain);
  });

  it('空でも落ちない', () => {
    expect(repairHistory([])).toEqual([]);
  });
});

describe('切り詰めが、対を割らない', () => {
  const exchange = (i: number): TimedContent[] => [
    user(`${i}日目です`),
    call('log_activity'),
    result('log_activity'),
    model(`${i}日目の返事`),
  ];
  const long = Array.from({ length: 30 }, (_, i) => exchange(i)).flat();

  /**
   * **role が user かどうかだけでは足りない。**
   * 道具の結果を返しているだけの turn も role は user なので、
   * そこで切ると「呼び出しの無い結果」が先頭に残る。
   */
  it('どこで切っても、対は割れない', () => {
    for (let max = 1; max <= long.length; max += 1) {
      expect(pairsAreSound(trimHistory(long, max) as TimedContent[]), `max=${max}`).toBe(true);
    }
  });

  it('圧縮しても、対は割れない', () => {
    for (let keep = 1; keep <= long.length; keep += 1) {
      expect(pairsAreSound(compactHistory(long, keep)), `keep=${keep}`).toBe(true);
    }
  });

  /** 切り詰めと圧縮を重ねても崩れないこと。保存はこの順で通る。 */
  it('切り詰めてから圧縮しても、対は割れない', () => {
    for (let max = 4; max <= long.length; max += 3) {
      for (const keep of [1, 4, 12, 40]) {
        const out = compactHistory(trimHistory(long, max) as TimedContent[], keep);
        expect(pairsAreSound(out), `max=${max} keep=${keep}`).toBe(true);
      }
    }
  });
});
