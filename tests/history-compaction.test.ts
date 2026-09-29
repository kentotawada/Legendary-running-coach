import { describe, expect, it } from 'vitest';
import { compactHistory } from '@/lib/store';
import type { TimedContent } from '@/lib/types';

/**
 * 履歴から、道具の配管を抜く。
 *
 * **入力の半分が履歴になっていた。** 1回の呼び出しで約27,000トークン、
 * うち14,000が過去のやり取り。その多くは機械どうしの往復で、
 * 中身はすでにカルテに入っている（指示文に要約が毎回載る）。
 */

const user = (text: string): TimedContent => ({ role: 'user', parts: [{ text }] });
const model = (text: string): TimedContent => ({ role: 'model', parts: [{ text }] });

const call = (name: string, args: Record<string, unknown>): TimedContent => ({
  role: 'model',
  parts: [{ functionCall: { name, args } }],
});
const result = (name: string, response: Record<string, unknown>): TimedContent => ({
  role: 'user',
  parts: [{ functionResponse: { name, response } }],
});

/** 道具を1回使う、ひとまとまりのやり取り。 */
const exchange = (say: string, tool: string, reply: string): TimedContent[] => [
  user(say),
  call(tool, { distanceKm: 10 }),
  result(tool, { ok: true, message: '記録した' }),
  model(reply),
];

const toolPartCount = (history: TimedContent[]) =>
  history.reduce(
    (sum, c) => sum + (c.parts ?? []).filter((p) => p.functionCall || p.functionResponse).length,
    0,
  );

const texts = (history: TimedContent[]) =>
  history.flatMap((c) => (c.parts ?? []).map((p) => p.text).filter(Boolean));

describe('古いやり取りの配管を抜く', () => {
  const long = [
    ...exchange('1日目 10km走りました', 'log_activity', 'お疲れさまです'),
    ...exchange('2日目 休みました', 'log_condition', '休養も練習です'),
    ...exchange('3日目 15km走りました', 'log_activity', 'いい流れですね'),
    ...exchange('4日目 調子いいです', 'log_condition', 'その調子で'),
    ...exchange('5日目 20km走りました', 'log_activity', '距離が伸びましたね'),
  ];

  it('古い配管は消え、話した言葉は残る', () => {
    const compact = compactHistory(long, 8);

    expect(toolPartCount(long)).toBe(10);
    expect(toolPartCount(compact)).toBeLessThan(toolPartCount(long));

    // **人が話した言葉は1つも失わない。** 連続性が切れると、コーチではなくなる。
    for (const said of ['1日目 10km走りました', '2日目 休みました', '3日目 15km走りました']) {
      expect(texts(compact)).toContain(said);
    }
    expect(texts(compact)).toContain('お疲れさまです');
  });

  it('直近のやり取りは、配管ごとそのまま残る', () => {
    const compact = compactHistory(long, 8);
    const tail = compact.slice(-8);
    expect(toolPartCount(tail)).toBe(toolPartCount(long.slice(-8)));
  });

  /** **これを割ると API に弾かれる。** 呼び出しだけ、結果だけ、が残ってはいけない。 */
  it('呼び出しと結果の対を、片方だけにしない', () => {
    for (let keep = 1; keep <= long.length + 2; keep += 1) {
      const compact = compactHistory(long, keep);
      const calls = compact.flatMap((c) => (c.parts ?? []).filter((p) => p.functionCall));
      const results = compact.flatMap((c) => (c.parts ?? []).filter((p) => p.functionResponse));
      expect(calls.length, `keep=${keep}`).toBe(results.length);
    }
  });

  it('短い履歴には手を触れない', () => {
    const short = [user('やあ'), model('こんにちは')];
    expect(compactHistory(short, 8)).toEqual(short);
  });

  /** 道具のやり取りばかりで切れ目が無ければ、無理に切らない。 */
  it('切れる場所が無ければ、そのまま返す', () => {
    const noBreak = [call('log_activity', {}), result('log_activity', {}), model('はい')];
    expect(compactHistory(noBreak, 1)).toEqual(noBreak);
  });

  it('配管を抜いて空になったやり取りは、残さない', () => {
    const compact = compactHistory(long, 8);
    for (const content of compact) expect((content.parts ?? []).length).toBeGreaterThan(0);
  });

  it('抜いた結果、同じ役割が続いたらつなげる', () => {
    const compact = compactHistory(long, 8);
    for (let i = 1; i < compact.length; i += 1) {
      if (compact[i].role === compact[i - 1].role) {
        // 直近のそのままの範囲では、道具のやり取りで role が続くことがある。
        const inTail = i >= compact.length - 8;
        expect(inTail, `${i} で ${compact[i].role} が続いている`).toBe(true);
      }
    }
  });

  /**
   * **見返せるはずの写真が、黙って消えてはいけない。**
   * 画像の本体を落とすのは stripInlineData の仕事で、あちらは跡を残す。
   * ここで先に消すと、道具をたくさん使ったターンで跡ごと消える。
   */
  it('画像の本体には手を触れない', () => {
    const withImage: TimedContent[] = [
      { role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } }, { text: 'これ読んで' }] },
      ...long,
    ];
    const compact = compactHistory(withImage, 8);
    const kept = compact.flatMap((c) => (c.parts ?? []).filter((p) => p.inlineData));
    expect(kept).toHaveLength(1);
  });

  it('時刻は落とさない', () => {
    const withTime: TimedContent[] = long.map((c, i) => ({ ...c, at: `2026-09-2${i % 9}T00:00:00Z` }));
    for (const content of compactHistory(withTime, 8)) {
      expect(content.at).toBeTruthy();
    }
  });
});

describe('どれだけ軽くなるか', () => {
  it('道具を使う会話では、目に見えて減る', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      exchange(`${i}日目の報告です`, 'log_activity', `${i}日目の返事です`),
    ).flat();

    const size = (h: TimedContent[]) => JSON.stringify(h).length;
    const before = size(many);
    const after = size(compactHistory(many, 12));

    // 半分以下になること。**ここが入力の半分を占めていた。**
    expect(after).toBeLessThan(before * 0.5);
  });
});
