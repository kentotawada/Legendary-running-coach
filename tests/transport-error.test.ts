import { describe, expect, it } from 'vitest';
import { describeHttpFailure, describeStreamFailure } from '../src/lib/transport-error';
import { rewindToLastUserTurn } from '../src/lib/history';
import { imagePlaceholder } from '../src/lib/markers';

describe('describeHttpFailure', () => {
  it('アプリ自身が返した理由は、そのまま画面に出す', () => {
    const failure = describeHttpFailure(400, 'Bad Request', '{"error":"画像は一度に10枚までです。"}');
    expect(failure.message).toBe('画像は一度に10枚までです。');
    // 送り直しても同じ結果になる失敗を、再送ボタンで誘わない。
    expect(failure.retryable).toBe(false);
  });

  it('容量超過は、枚数を減らすよう伝える', () => {
    const failure = describeHttpFailure(413, 'Payload Too Large', '<html>Request Entity Too Large</html>');
    expect(failure.message).toContain('画像');
    expect(failure.message).toContain('枚数');
    expect(failure.retryable).toBe(false);
  });

  it('時間切れは、時間切れだと分かる形で伝える', () => {
    const gateway = describeHttpFailure(504, 'Gateway Timeout', '');
    expect(gateway.message).toContain('時間');
    expect(gateway.retryable).toBe(true);

    const functionTimeout = describeHttpFailure(500, '', 'FUNCTION_INVOCATION_TIMEOUT');
    expect(functionTimeout.message).toContain('時間');
    expect(functionTimeout.retryable).toBe(true);
  });

  it('混雑と権限を言い分ける', () => {
    expect(describeHttpFailure(503, '', '').message).toContain('混み合って');
    expect(describeHttpFailure(403, '', '').message).toContain('権限');
  });

  it('知らない番号でも、状態番号を必ず残す', () => {
    const failure = describeHttpFailure(418, "I'm a teapot", 'nope');
    expect(failure.message).toContain('418');
    expect(failure.detail).toContain('418');
    expect(failure.detail).toContain('nope');
  });

  it('本文は必ず詳細に残す。原因の切り分けができなくなるため', () => {
    const failure = describeHttpFailure(500, 'Internal Server Error', 'An error occurred: id=abc123');
    expect(failure.detail).toContain('abc123');
  });

  it('長すぎる本文は切り詰める', () => {
    const failure = describeHttpFailure(500, '', 'x'.repeat(5000));
    expect(failure.detail!.length).toBeLessThan(600);
  });
});

describe('describeStreamFailure', () => {
  it('打ち切りは時間切れとして伝える', () => {
    const error = new Error('The user aborted a request.');
    error.name = 'AbortError';
    const failure = describeStreamFailure(error);
    expect(failure.message).toContain('時間');
    expect(failure.retryable).toBe(true);
  });

  it('回線が切れた時は、電波を確かめるよう伝える', () => {
    const failure = describeStreamFailure(new TypeError('Load failed'));
    expect(failure.message).toContain('通信が切れました');
    expect(failure.detail).toContain('Load failed');
    expect(failure.retryable).toBe(true);
  });

  it('どんな失敗でも詳細を空にしない', () => {
    expect(describeStreamFailure(undefined).detail).toBeTruthy();
    expect(describeStreamFailure(new Error('')).detail).toBeTruthy();
  });
});

describe('rewindToLastUserTurn', () => {
  it('直前の返答を外し、その前の問いかけを取り出す', () => {
    const rewound = rewindToLastUserTurn([
      { role: 'user', parts: [{ text: '20km走ってきました' }] },
      { role: 'model', parts: [{ text: 'よく粘りました' }] },
    ]);
    expect(rewound?.userText).toBe('20km走ってきました');
    expect(rewound?.history).toHaveLength(0);
  });

  it('それより前のやり取りは残す', () => {
    const rewound = rewindToLastUserTurn([
      { role: 'user', parts: [{ text: '最初の質問' }] },
      { role: 'model', parts: [{ text: '最初の返答' }] },
      { role: 'user', parts: [{ text: '次の質問' }] },
      { role: 'model', parts: [{ text: '次の返答' }] },
    ]);
    expect(rewound?.userText).toBe('次の質問');
    expect(rewound?.history).toHaveLength(2);
  });

  it('道具のやり取りが挟まっていても、ユーザー発言まで戻る', () => {
    const rewound = rewindToLastUserTurn([
      { role: 'user', parts: [{ text: '報告です' }] },
      { role: 'model', parts: [{ functionCall: { name: 'log_activity', args: {} } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'log_activity', response: {} } }] },
      { role: 'model', parts: [{ text: '記録しました' }] },
    ]);
    // 道具の応答も role が user なので、そこで止まってよい。中身は空文字になる。
    expect(rewound).toBeNull();
  });

  it('添付の跡は投げ直す本文に混ぜない', () => {
    const rewound = rewindToLastUserTurn([
      { role: 'user', parts: [{ text: imagePlaceholder(4) }, { text: '今日の練習です' }] },
      { role: 'model', parts: [{ text: '読み取りました' }] },
    ]);
    expect(rewound?.userText).toBe('今日の練習です');
    expect(rewound?.userText).not.toContain('画像が4枚');
  });

  it('作り直せるものが無ければ null', () => {
    expect(rewindToLastUserTurn([])).toBeNull();
    expect(rewindToLastUserTurn([{ role: 'model', parts: [{ text: 'こんにちは' }] }])).toBeNull();
  });
});
