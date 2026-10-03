'use client';

import { useEffect, useState } from 'react';

interface Props {
  /** 積み上がっている練習の数。**失って困るものが出来てから出す。** */
  activityCount: number;
  onOpen: () => void;
}

/** 一度消したら、もう出さない。同じ案内を何度も出すのは、ただのしつこい宣伝になる。 */
const KEY = 'coach.keep.dismissed';

/**
 * **これだけ積み上げてからだと、出す。**
 * 初日に出すとただの登録の壁になる。メールを求められた時点で
 * ほとんどの人が離れるので、このアプリは未ログインでも使えるようにしてある。
 */
const ENOUGH = 3;

/**
 * 未ログインの記録が、端末ごと消えることを知らせる帯。
 *
 * **ログインの入口が、カルテの奥にしか無かった。**
 * そこまで開く人しか辿り着けないので、何日も積み上げた人が、
 * 機種変更やブラウザの入れ替えで全部失う経路が残っていた。
 * しかも失ったことに気づくのは、失った後にしかならない。
 *
 * 出すのは**失って困るものが出来てから。** 登録を先に求めない方針は変えない。
 */
export default function KeepRecordsBanner({ activityCount, onOpen }: Props) {
  const [dismissed, setDismissed] = useState(true);

  // 端末に覚えた「もう消した」は、描かれた後でないと読めない。
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  if (dismissed || activityCount < ENOUGH) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // 覚えられない環境でも、その場で消えることは変わらない。
    }
  };

  return (
    <div className="flex items-center gap-3 border-b border-line bg-warn-soft px-4 py-2.5">
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="block t-note font-semibold leading-tight text-warn">
          記録は、いまこの端末にだけ残っています
        </span>
        <span className="mt-0.5 block t-note leading-tight text-muted">
          ログインしておくと、機種を変えても{activityCount}件の記録が残ります
        </span>
      </button>
      <button
        type="button"
        onClick={onOpen}
        /*
          帯は警告の色、ボタンは強調の色。**暗い配色では警告の色が明るくなる**ので、
          そこに白い字を置くと読めない。字の色まで決まっている強調の組み合わせを使う。
        */
        className="shrink-0 rounded-full bg-accent px-3.5 py-2 t-note font-semibold text-[var(--accent-fg)]"
      >
        残す
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="この案内を閉じる"
        className="-mr-1 shrink-0 px-1 t-body leading-none text-muted"
      >
        ×
      </button>
    </div>
  );
}
