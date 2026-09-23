import type { Content } from '@google/genai';
import { attachmentCountOf } from './markers';

/**
 * 返答を作り直すために、直前のやり取りを履歴から巻き戻す。
 *
 * 外したユーザー発言の本文をそのまま返すので、呼び出し側はそれを投げ直せばよい。
 * 作り直せるものが無ければ null。
 */
export function rewindToLastUserTurn(
  history: Content[],
): { history: Content[]; userText: string } | null {
  const rewound = [...history];
  while (rewound.length > 0 && rewound[rewound.length - 1].role !== 'user') rewound.pop();
  const lastUser = rewound.pop();
  if (!lastUser) return null;

  const userText = (lastUser.parts ?? [])
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    // 添付の跡は指示ではないので、投げ直す本文からは外す。
    .filter((text) => text && attachmentCountOf(text) === 0)
    .join('')
    .trim();

  return userText ? { history: rewound, userText } : null;
}
