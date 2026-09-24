/**
 * 画面の見え方の設定。
 *
 * 目の調子も、読む場所（走った直後の屋外か、寝る前の布団か）も人によって違う。
 * この設定はその端末の見え方の話なので、サーバーには送らず端末に残す。
 */

export type FontSizeId = 'small' | 'medium' | 'large';

export interface FontSizeOption {
  id: FontSizeId;
  label: string;
  /** 本文 15px に掛ける倍率。medium が今までの大きさ。 */
  scale: number;
  hint: string;
}

export const FONT_SIZES: FontSizeOption[] = [
  { id: 'small', label: '小', scale: 0.87, hint: '一度に多く読めます' },
  { id: 'medium', label: '中', scale: 1, hint: '標準の大きさ' },
  { id: 'large', label: '大', scale: 1.2, hint: '走った直後でも読みやすい' },
];

export const DEFAULT_FONT_SIZE: FontSizeId = 'medium';

export const FONT_SIZE_STORAGE_KEY = 'coach.fontSize';

/**
 * 入力欄の文字の下限。
 *
 * iOS Safari は **16px 未満の入力欄にフォーカスすると画面を勝手に拡大する。**
 * 拡大されると画面の端が切れ、送信ボタンまで見えなくなる。
 * 本文を小さくしても、打ち込む場所だけはここを下回らせない。
 */
export const MIN_INPUT_FONT_PX = 16;

/** 本文サイズと同じ比率で動かしつつ、入力欄としての下限を守る。 */
export function inputFontSize(scale: number): number {
  return Math.max(MIN_INPUT_FONT_PX, 15 * scale);
}

export function findFontSize(id: string | null | undefined): FontSizeOption {
  return FONT_SIZES.find((size) => size.id === id) ?? FONT_SIZES.find((size) => size.id === DEFAULT_FONT_SIZE)!;
}

/**
 * 倍率を CSS 変数として流し込む。
 * 本文サイズはすべてこの変数から計算しているので、ここ一か所で画面全体が変わる。
 */
export function applyFontSize(id: FontSizeId): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--chat-font-scale', String(findFontSize(id).scale));
}

export function loadFontSize(): FontSizeId {
  if (typeof window === 'undefined') return DEFAULT_FONT_SIZE;
  try {
    return findFontSize(window.localStorage.getItem(FONT_SIZE_STORAGE_KEY)).id;
  } catch {
    // プライベートブラウズなどで読めないことがある。既定値で動けばよい。
    return DEFAULT_FONT_SIZE;
  }
}

export function saveFontSize(id: FontSizeId): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, id);
  } catch {
    // 保存できなくても、その場の表示は変わっている。黙って諦める。
  }
}

/**
 * 画面が描かれる前に文字サイズを当てるための一行スクリプト。
 * useEffect で当てると、標準サイズで一瞬描かれてから切り替わってちらつく。
 */
export const FONT_SIZE_BOOT_SCRIPT = `(function(){try{var m=${JSON.stringify(
  Object.fromEntries(FONT_SIZES.map((size) => [size.id, size.scale])),
)};var v=m[localStorage.getItem(${JSON.stringify(FONT_SIZE_STORAGE_KEY)})];if(v)document.documentElement.style.setProperty('--chat-font-scale',String(v));}catch(e){}})()`;
