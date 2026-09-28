'use client';

import { useEffect } from 'react';

/** 1回開いている間に送る報告の上限。同じ壊れ方を何百回も送らない。 */
const MAX_REPORTS = 5;

/**
 * このアプリのせいではない報告。送っても直しようがない。
 *  - 拡張機能の中で起きたもの
 *  - 別のサイトの読み込みで起きて、中身が伏せられているもの（"Script error."）
 *  - 画面の大きさの変化を追いかける仕組みの、害の無い警告
 */
const NOISE = [/^Script error\.?$/i, /ResizeObserver loop/i, /extension:\/\//i, /chrome-extension/i];

/**
 * 画面の中で起きた不具合を、運営に知らせる。
 *
 * **サーバーまで何も届かずに止まる壊れ方は、これが無いと誰にも分からない。**
 * 「開いたら真っ白」「押しても反応しない」は、利用者が黙って離れて終わる。
 * 何も画面には出さない。報告の成否で、画面の動きも変えない。
 */
export default function ErrorReporter() {
  useEffect(() => {
    const sent = new Set<string>();

    const report = (message: string, stack?: string, source?: string) => {
      const text = message.trim();
      if (!text || NOISE.some((pattern) => pattern.test(text) || (source && pattern.test(source)))) return;
      if (sent.has(text) || sent.size >= MAX_REPORTS) return;
      sent.add(text);
      try {
        void fetch('/api/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, stack, source }),
          // 画面を閉じる直前の不具合も、送り切る。
          keepalive: true,
        }).catch(() => undefined);
      } catch {
        // 報告のための報告はしない。
      }
    };

    const onError = (event: ErrorEvent) => {
      const error = event.error as Error | undefined;
      report(error?.message ?? event.message, error?.stack, event.filename);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason as unknown;
      if (reason instanceof Error) report(reason.message, reason.stack);
      else report(String(reason));
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
