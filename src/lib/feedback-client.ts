/**
 * 返答への評価を、持ち主に届ける（/api/feedback → /admin）。
 *
 * **送れなくても、画面の動きは変えない。** 評価は利用者の操作の「おまけ」で、
 * 失敗を知らせてまで押し直してもらうものではない。
 */
export function sendFeedback(input: { rating: 'good' | 'bad'; reason?: string; reply: string }): void {
  try {
    void fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // 何もしない。
  }
}

/**
 * 「良くない」の理由の候補。**1回押すだけで終わる**ように、先に並べておく。
 * 自由に書く欄もあるが、書かせる前提にすると、ほとんどの人が理由をくれない。
 */
export const BAD_REASONS = ['間違っている', '自分に合っていない', '長い・くどい', '分かりにくい', '口調が合わない'] as const;
