'use client';

import { useEffect } from 'react';

/**
 * 土台ごと落ちた時。
 *
 * **ここは layout.tsx の外側で描かれる。** 書体もスタイルシートも当たらない
 * 前提で書く。当たらないものに頼って、その上でさらに壊れるのは最悪なので、
 * 色と間隔は全部この中に直接書く。
 *
 * ここまで来るのは滅多にないが、来た時がいちばん危ない。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    try {
      void fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `${error.name}: ${error.message}`,
          stack: error.stack,
          source: error.digest ? `global-error:${error.digest}` : 'global-error',
        }),
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      // 報告のための報告はしない。
    }
  }, [error]);

  return (
    <html lang="ja">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          background: '#fcfcfb',
          color: '#16161a',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: '64px 20px 24px',
          lineHeight: 1.7,
        }}
      >
        <div style={{ maxWidth: 420, margin: '0 auto' }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, letterSpacing: '0.12em' }}>
            RUNCOACH
          </p>
          <h1 style={{ margin: '32px 0 0', fontSize: 20, lineHeight: 1.5 }}>
            うまく開けませんでした
          </h1>
          <p
            style={{
              margin: '16px 0 0',
              padding: '14px 16px',
              borderRadius: 14,
              background: '#e9f3ed',
              color: '#2f7d52',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            これまでの記録は消えていません。
          </p>
          <p style={{ margin: '16px 0 0', fontSize: 13, color: '#71717a' }}>
            一時的なものかもしれません。もう一度開くと、たいてい直ります。
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 24,
              width: '100%',
              padding: '14px 0',
              border: 0,
              borderRadius: 999,
              background: '#cf4d18',
              color: '#ffffff',
              fontSize: 15,
              fontWeight: 700,
            }}
          >
            もう一度開く
          </button>
          {error.digest && (
            <p style={{ margin: '24px 0 0', fontSize: 11, color: '#71717a' }}>
              識別子: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
