'use client';

import { useEffect, useState } from 'react';

/**
 * 何かが壊れた時に出す画面。
 *
 * **いちばん怖いのは、白い画面で「記録が消えた」と思われること。**
 * 預けているのは練習の記録と体のことなので、消えたと思われた時点で
 * 二度と開いてもらえない。実際には何も消えていないので、それを真っ先に言う。
 *
 * 謝罪から始めない。**開いた人が次にできることを先に置く。**
 * 何が起きたかの説明は、その下でいい。
 */
export default function Trouble({
  title,
  lead,
  error,
  source,
  onRetry,
  retryLabel = 'もう一度開く',
}: {
  title: string;
  /** 見出しの下の一行。状況によって変える。 */
  lead: string;
  /** 分かっている範囲の中身。運営に知らせる時に添える。 */
  error?: Error & { digest?: string };
  /** どこで起きたか。報告を読む時の手がかり。 */
  source: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const [told, setTold] = useState(false);

  /**
   * 開いた時点で、黙って知らせる。
   *
   * **「報告する」を押してもらえることを当てにしない。** 壊れた画面で
   * さらにボタンを押す人は、ほとんどいない。押さなかった分が
   * 見えないままになるので、こちらから送る。
   */
  useEffect(() => {
    if (!error) return;
    try {
      void fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `${error.name}: ${error.message}`,
          stack: error.stack,
          source: error.digest ? `${source}:${error.digest}` : source,
        }),
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      // 報告のための報告はしない。
    }
  }, [error, source]);

  return (
    <div className="flex min-h-dvh flex-col bg-bg px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-16">
      <div className="mx-auto w-full max-w-[420px] flex-1">
        <div className="mb-8 flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="" width={28} height={28} className="rounded-[8px]" />
          <span className="text-[14px] font-bold tracking-[0.12em]">RUNCOACH</span>
        </div>

        <h1 className="text-[20px] font-bold leading-snug">{title}</h1>

        {/*
          **ここが本題。** 記録が無事であることを、いちばん強く出す。
          消えたと思って開き直さない人を、ここで引き止める。
        */}
        <p className="mt-4 rounded-[14px] bg-good-soft px-4 py-3.5 text-[14px] font-semibold leading-relaxed text-good">
          これまでの記録は消えていません。
        </p>

        <p className="mt-4 text-[13px] leading-relaxed text-muted">{lead}</p>

        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-6 w-full rounded-full bg-accent py-3.5 text-[15px] font-bold text-[var(--accent-fg)]"
          >
            {retryLabel}
          </button>
        )}

        {/*
          **画面の中で移動しない。** ここに来ているということは、
          いま動いている側が壊れている。その状態のまま画面内で移動しても、
          同じ所でまた止まる。読み込み直して、全部を作り直す。
        */}
        <button
          type="button"
          onClick={() => {
            // 画面内の移動（router.push）では、壊れている側が残る。ここは読み込み直す。
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.href = '/';
          }}
          className="mt-3 block w-full rounded-full border border-line py-3.5 text-center text-[15px] font-semibold"
        >
          最初の画面へ
        </button>

        <div className="mt-10 border-t border-line pt-5">
          <p className="text-[12px] leading-relaxed text-muted">
            何度やっても同じなら、教えてください。どの画面で何をした時かが分かると、直せます。
          </p>
          <button
            type="button"
            disabled={told}
            onClick={() => setTold(true)}
            className="mt-2.5 text-[13px] font-semibold text-accent underline underline-offset-4 disabled:text-muted disabled:no-underline"
          >
            {told ? '受け取りました。ありがとうございます。' : 'この不具合を知らせる'}
          </button>
          {/*
            押した時に送り直さない。開いた時点でもう送ってある。
            ここは「届いたか分からない」という不安だけを引き取る。
          */}
        </div>

        {error?.digest && (
          <p className="mt-6 text-[11px] text-muted">
            識別子: <span className="font-mono">{error.digest}</span>
          </p>
        )}
      </div>
    </div>
  );
}
