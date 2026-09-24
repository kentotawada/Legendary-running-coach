'use client';

import { useEffect } from 'react';

/**
 * ソフトキーボードが覆っている高さを CSS 変数に流す。
 *
 * iOS は文字を打ち始めても `100dvh` を縮めない。
 * 画面の外枠が縮まないまま入力欄がキーボードの下に入るので、
 * Safari が画面そのものをずらして見せようとし、端が切れる。
 *
 * 覆われた分を自分で測って縮めれば、ずらされずに済む。
 */

/** この程度の変化はアドレスバーの伸縮。キーボードとは見なさない。 */
const KEYBOARD_THRESHOLD_PX = 80;

/** 画面の大半を削ってしまう値は、測り違いとして捨てる。 */
const MAX_RATIO = 0.6;

export function useKeyboardInset(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    if (!viewport) return;

    const update = () => {
      const covered = window.innerHeight - viewport.height;
      const inset =
        covered < KEYBOARD_THRESHOLD_PX
          ? 0
          : Math.min(covered, Math.round(window.innerHeight * MAX_RATIO));
      root.style.setProperty('--keyboard-inset', `${Math.round(inset)}px`);
    };

    update();
    viewport.addEventListener('resize', update);
    return () => {
      viewport.removeEventListener('resize', update);
      root.style.setProperty('--keyboard-inset', '0px');
    };
  }, []);
}
