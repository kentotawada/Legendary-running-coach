'use client';

import { useState } from 'react';

/**
 * ホーム画面に追加してもらう。
 *
 * **これをやっていない人には、通知が1通も届かない。**（iOS は追加が条件）
 * つまり「こちらから声をかける」機能が、まるごと無いのと同じ状態になる。
 *
 * これまでは通知の設定の奥に案内があった。**通知をオンにしようとした人しか
 * 辿り着けない場所**で、順番が逆になっていた。
 *
 * 出し方の原則:
 *  - **初日には出さない。** 失って困るものが出来てから出す
 *  - 閉じたら二度と出さない
 *  - すでに追加済み（standalone）なら、最初から出さない
 */

const DISMISS_KEY = 'rc_install_dismissed';

type Platform = 'ios' | 'other';

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
    // iOS Safari は display-mode を返さないことがある。
    return (window.navigator as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

/** 一度閉じたか。**閉じたものは二度と出さない。** */
function wasDismissed(): boolean {
  try {
    return Boolean(localStorage.getItem(DISMISS_KEY));
  } catch {
    // 保存が使えない環境でも、案内そのものは出してよい。
    return false;
  }
}

function platformOf(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ? 'ios' : 'other';
}

export default function InstallBanner() {
  const [dismissed, setDismissed] = useState(false);

  /*
    **効果（useEffect）で状態を立てない。**
    この帯は `ready` が立ってから初めて描かれる＝最初の描画がすでにブラウザ側なので、
    その場で調べてよい。効果に逃がすと、1回ぶん余計に描き直すことになる。
  */
  const show =
    !dismissed && typeof window !== 'undefined' && !isStandalone() && !wasDismissed();
  const platform = platformOf();

  const close = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // 閉じた記録が残らないだけ。次に開いた時にまた出る。
    }
  };

  if (!show) return null;

  return (
    <div className="flex items-start gap-2.5 border-b border-line bg-sunken px-4 py-2.5">
      <svg
        viewBox="0 0 24 24"
        className="mt-0.5 h-[18px] w-[18px] shrink-0 text-accent"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="5" y="2" width="14" height="20" rx="3" />
        <path d="M12 7v6M9 10h6" />
      </svg>

      <div className="min-w-0 flex-1">
        <p className="t-note font-bold">ホーム画面に追加しておくと、次から1タップです</p>
        <p className="mt-0.5 t-note leading-relaxed text-muted">
          {platform === 'ios' ? (
            <>
              下の<strong className="font-semibold text-fg">共有ボタン</strong>（□に↑）→
              <strong className="font-semibold text-fg">「ホーム画面に追加」</strong>。
              追加すると、走り終えた時の声かけも届くようになります。
            </>
          ) : (
            <>
              ブラウザのメニュー →
              <strong className="font-semibold text-fg">「アプリをインストール」</strong>（または「ホーム画面に追加」）。
              追加すると、走り終えた時の声かけも届くようになります。
            </>
          )}
        </p>
      </div>

      <button
        type="button"
        onClick={close}
        aria-label="この案内を閉じる"
        className="shrink-0 rounded-full p-1 text-muted active:scale-95"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
