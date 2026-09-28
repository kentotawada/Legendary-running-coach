/**
 * 画面の見え方の設定。
 *
 * 目の調子も、読む場所（走った直後の屋外か、寝る前の布団か）も人によって違う。
 * この設定はその端末の見え方の話なので、サーバーには送らず端末に残す。
 */

import { DEFAULT_TIME_ZONE } from './day';

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

/**
 * 吹き出しに出す時刻。
 *
 * **いつの話なのかが分からないと、会話を読み返せない。**
 * 今日のものは時刻だけ（8:13）、それより前は日付も添える（9/28 22:39）。
 * **端末の時計ではなく、アプリの地域の時刻で出す。**
 * スタンプも連続日数も通知も同じ地域で数えているので、ここだけ端末に合わせると、
 * 「今日」の範囲が表示とずれる。
 *
 * この仕組みより前の記録には時刻が無い。その時は null を返し、**何も出さない。**
 * 分からないものを、それらしい時刻で埋めない。
 */
export function formatTime(
  iso: string | undefined,
  now: Date = new Date(),
  timeZone: string = DEFAULT_TIME_ZONE,
): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;

  const dayOf = (date: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

  return new Intl.DateTimeFormat('ja-JP', {
    timeZone,
    ...(dayOf(at) === dayOf(now) ? {} : { month: 'numeric', day: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  }).format(at);
}
