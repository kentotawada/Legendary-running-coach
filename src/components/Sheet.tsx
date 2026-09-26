'use client';

import { useEffect } from 'react';

interface Props {
  /** 支援技術に読ませる名前。 */
  label: string;
  /** 見出しに出す文字。省略すると見出し行を出さない。 */
  title?: string;
  children: React.ReactNode;
  onClose: () => void;
  /** 右上に置く追加の操作。 */
  action?: React.ReactNode;
  /**
   * 前の画面へ戻る。別のシートから開かれた時だけ渡す。
   * **閉じると全部消えるのは、開いた道を覚えていないのと同じ。**
   * カルテから開いた画面を閉じたら、カルテに戻るのが自然。
   */
  onBack?: () => void;
  /** 戻り先の呼び名。「カルテへ」のように出す。 */
  backLabel?: string;
}

/**
 * 下から出る共通のシート。
 * 画面ごとに枠を書き分けると、角丸や余白がじわじわずれて全体が雑に見える。
 */
export default function Sheet({
  label,
  title,
  children,
  onClose,
  action,
  onBack,
  backLabel,
}: Props) {
  // 背面のチャットが一緒にスクロールしないようにする。
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Esc は「1つ戻る」。戻り先が無い時だけ閉じる。
      if (event.key === 'Escape') (onBack ?? onClose)();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onBack]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <button type="button" className="flex-1" aria-label="閉じる" onClick={onClose} />

      <div className="safe-bottom max-h-[86dvh] animate-sheet overflow-y-auto rounded-t-[26px] bg-elevated shadow-[0_-8px_40px_rgba(0,0,0,0.18)]">
        {/* つまんで下げられることが見て分かる持ち手。 */}
        <div className="sticky top-0 z-10 bg-elevated pt-2.5">
          <div aria-hidden="true" className="mx-auto h-1 w-9 rounded-full bg-line" />
          {(title || action || onBack) && (
            <div className="mt-2 flex items-center gap-2 px-5 pb-3">
              {onBack && (
                <button
                  type="button"
                  onClick={onBack}
                  aria-label={backLabel ? `${backLabel}に戻る` : '前の画面に戻る'}
                  className="-ml-2 flex h-9 shrink-0 items-center gap-0.5 rounded-full pl-1 pr-2 text-[13px] font-medium text-accent transition active:scale-95"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m15 18-6-6 6-6" />
                  </svg>
                  {backLabel && <span className="whitespace-nowrap">{backLabel}</span>}
                </button>
              )}
              <h2 className="min-w-0 flex-1 truncate text-[17px] font-bold tracking-tight">{title}</h2>
              {action}
              <button
                type="button"
                onClick={onClose}
                aria-label="閉じる"
                className="-mr-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition active:scale-90"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}
        </div>

        <div className="px-5 pb-8">{children}</div>
      </div>
    </div>
  );
}
