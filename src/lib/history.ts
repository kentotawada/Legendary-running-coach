import type { Content } from '@google/genai';
import { attachmentCountOf } from './markers';

/**
 * 返答を作り直すために、直前のやり取りを履歴から巻き戻す。
 *
 * 外したユーザー発言の本文をそのまま返すので、呼び出し側はそれを投げ直せばよい。
 * 作り直せるものが無ければ null。
 */
function splitLastUserTurn(history: Content[]): { before: Content[]; lastUser?: Content } {
  const before = [...history];
  while (before.length > 0 && before[before.length - 1].role !== 'user') before.pop();
  const lastUser = before.pop();
  return { before, lastUser };
}

/**
 * 直前のやり取りを取り消す。
 * 送った本文を書き直して送り直す時に、古い方を履歴から外すために使う。
 */
export function dropLastUserTurn(history: Content[]): Content[] {
  return splitLastUserTurn(history).before;
}

export function rewindToLastUserTurn(
  history: Content[],
): { history: Content[]; userText: string } | null {
  const { before: rewound, lastUser } = splitLastUserTurn(history);
  if (!lastUser) return null;

  const userText = (lastUser.parts ?? [])
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    // 添付の跡は指示ではないので、投げ直す本文からは外す。
    .filter((text) => text && attachmentCountOf(text) === 0)
    .join('')
    .trim();

  return userText ? { history: rewound, userText } : null;
}
