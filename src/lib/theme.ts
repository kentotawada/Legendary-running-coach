/**
 * 画面を、明るくするか暗くするか。
 *
 * これまでは端末の設定（prefers-color-scheme）に従うだけで、
 * **アプリの中では選べなかった。** 端末を暗くしていても、
 * 走る前の屋外では明るいほうが読めることがあるし、その逆もある。
 *
 * 文字の大きさ（display.ts）と同じ作りにしてある。
 * その端末の見え方の話なので、サーバーには送らず端末に残す。
 */

export type ThemeId = 'auto' | 'light' | 'dark';

export interface ThemeOption {
  id: ThemeId;
  label: string;
  hint: string;
}

export const THEMES: ThemeOption[] = [
  { id: 'auto', label: '自動', hint: '端末の設定に合わせる' },
  { id: 'light', label: '白', hint: '明るい画面' },
  { id: 'dark', label: '黒', hint: '暗い画面' },
];

export const DEFAULT_THEME: ThemeId = 'auto';
export const THEME_STORAGE_KEY = 'coach.theme';

export function findTheme(id: string | null | undefined): ThemeOption {
  return THEMES.find((theme) => theme.id === id) ?? THEMES.find((theme) => theme.id === DEFAULT_THEME)!;
}

/**
 * 画面に当てる。
 *
 * `data-theme` を根に置き、CSS 側がそれを見て色を差し替える。
 * **自動の時は属性を外す**ので、端末の設定（prefers-color-scheme）がそのまま効く。
 */
export function applyTheme(id: ThemeId): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (id === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', id);
}

export function loadTheme(): ThemeId {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  try {
    return findTheme(window.localStorage.getItem(THEME_STORAGE_KEY)).id;
  } catch {
    // プライベートブラウズなどで読めないことがある。既定値で動けばよい。
    return DEFAULT_THEME;
  }
}

export function saveTheme(id: ThemeId): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // 保存できなくても、その場の表示は変わっている。黙って諦める。
  }
}

/**
 * 画面が描かれる前に当てるための一行スクリプト。
 *
 * **効果（useEffect）で当てると、白い画面が一瞬出てから黒くなる。**
 * 暗いところで開いた時に目を灼くので、描く前に決めておく。
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var v=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(v==='light'||v==='dark')document.documentElement.setAttribute('data-theme',v);}catch(e){}})()`;
