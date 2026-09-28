import { describe, expect, it } from 'vitest';
import { formatTime } from '@/lib/display';
import { toDisplayMessages } from '@/lib/profile';
import type { TimedContent } from '@/lib/types';

/**
 * 吹き出しの時刻。
 *
 * **いつ送って、いつ返ってきたのかが分からないと、会話を読み返せない。**
 * 会話は Gemini の Content のまま保存していたので、時刻がどこにも残っていなかった。
 */

const NOW = new Date('2026-09-29T08:13:00+09:00');

describe('時刻の出し方', () => {
  it('今日のものは、時刻だけ', () => {
    expect(formatTime('2026-09-29T08:13:00+09:00', NOW)).toBe('8:13');
  });

  it('今日より前のものは、日付も添える', () => {
    expect(formatTime('2026-09-28T22:39:00+09:00', NOW)).toBe('9/28 22:39');
  });

  /** 分からないものを、それらしい時刻で埋めない。 */
  it('時刻が無ければ、何も出さない', () => {
    expect(formatTime(undefined, NOW)).toBeNull();
    expect(formatTime('', NOW)).toBeNull();
  });

  it('壊れた値でも、落ちずに何も出さない', () => {
    expect(formatTime('not-a-date', NOW)).toBeNull();
  });

  it('年が違えば、同じ月日でも日付を添える', () => {
    expect(formatTime('2025-09-29T08:13:00+09:00', NOW)).toBe('9/29 8:13');
  });
});

describe('保存した会話から、時刻を取り出す', () => {
  const history: TimedContent[] = [
    { role: 'user', parts: [{ text: '今日は10km走りました' }], at: '2026-09-29T08:10:00+09:00' },
    { role: 'model', parts: [{ text: 'お疲れさまです。' }], at: '2026-09-29T08:10:30+09:00' },
    // この仕組みより前に保存された分。時刻が無い。
    { role: 'user', parts: [{ text: '昨日の記録です' }] },
  ];

  it('時刻が、そのまま画面用の発言に乗る', () => {
    const messages = toDisplayMessages(history);
    expect(messages[0].at).toBe('2026-09-29T08:10:00+09:00');
    expect(messages[1].at).toBe('2026-09-29T08:10:30+09:00');
  });

  /** 古い記録には無い。**無いものを、あることにしない。** */
  it('時刻の無い発言は、時刻を持たないまま', () => {
    expect(toDisplayMessages(history)[2].at).toBeUndefined();
  });
});

/**
 * 挨拶の位置。
 *
 * **一覧の末尾に固定で描いていたので、送った発言より後ろに出ていた。**
 * 「また来てくれましたね」が、自分の発言への返事の下に出る状態だった。
 * 画面と同じ組み立てを、ここで確かめる。
 */
function shownWith(messages: { id: string }[], greeting: string | null, greetingAt: number | null) {
  if (!greeting) return messages;
  const at = greetingAt ?? messages.length;
  return [...messages.slice(0, at), { id: 'greeting' }, ...messages.slice(at)];
}

describe('挨拶は、開いた時点の位置に入る', () => {
  const history = [{ id: '0' }, { id: '1' }];

  it('開いた直後は、会話の最後に出る', () => {
    expect(shownWith(history, 'また来てくれましたね。', 2).map((m) => m.id)).toEqual(['0', '1', 'greeting']);
  });

  /** **これが直したかったこと。** 送った発言と返事は、挨拶の後ろに並ぶ。 */
  it('そのあと送った発言と返事は、挨拶より後ろに並ぶ', () => {
    const after = [...history, { id: '2' }, { id: '3' }];
    expect(shownWith(after, 'また来てくれましたね。', 2).map((m) => m.id)).toEqual([
      '0',
      '1',
      'greeting',
      '2',
      '3',
    ]);
  });

  it('挨拶が無ければ、そのまま', () => {
    expect(shownWith(history, null, null)).toEqual(history);
  });
});
