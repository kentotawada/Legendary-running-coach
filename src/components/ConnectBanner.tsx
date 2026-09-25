'use client';

import { useEffect, useState } from 'react';

interface Props {
  onOpen: () => void;
}

/** 一度消したら、もう出さない。同じ案内を何度も出すのは、ただのしつこい宣伝になる。 */
const KEY = 'coach.connect.dismissed';

/**
 * まだつないでいない人に、入口が在ることを一度だけ知らせる帯。
 *
 * カルテの中だけに置くと、そこまで開く人しか辿り着けません。
 * 連携はこのアプリの値打ちが変わる一手なので、**閉じるまでは目に入る場所**に出します。
 */
export default function ConnectBanner({ onOpen }: Props) {
  const [shown, setShown] = useState(false);

  // 端末に覚えた「もう消した」は、描かれた後でないと読めない。
  useEffect(() => {
    try {
      setShown(localStorage.getItem(KEY) !== '1');
    } catch {
      setShown(true);
    }
  }, []);

  if (!shown) return null;

  const dismiss = () => {
    setShown(false);
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // 覚えられない環境でも、その場で消えることは変わらない。
    }
  };

  return (
    <div className="flex items-center gap-3 border-b border-line bg-accent-soft px-4 py-2.5">
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="block text-[13px] font-semibold leading-tight text-accent">
          ⌚️ 時計やアプリの記録を、自動で取り込めます
        </span>
        <span className="mt-0.5 block text-[11px] leading-tight text-muted">
          Garmin・Apple Watch・Nike Run Club など。設定は最初の一度だけ
        </span>
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="shrink-0 rounded-full bg-accent px-3.5 py-2 text-[12px] font-semibold text-[var(--accent-fg)]"
      >
        つなぐ
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="この案内を閉じる"
        className="-mr-1 shrink-0 px-1 text-[15px] leading-none text-muted"
      >
        ×
      </button>
    </div>
  );
}
