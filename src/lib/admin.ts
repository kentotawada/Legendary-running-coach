/**
 * 運営の画面（/admin）に出す数を組み立てる。画面から切り離してあるのは、数え方を確かめるため。
 *
 * **事業として見たいのは、次の4つ。**
 *  - 何人来て、何人が使い始めたか（signup）
 *  - 1人あたりいくらかかっているか（tokens → 円）
 *  - 無料の上限に何人が当たったか（＝お金を払ってでも使いたい人の目安）
 *  - 本当に動いているか（通知を届けた数、不具合の数）
 */

import { cleanEnv } from './build-info';
import { coachDate } from './day';

/** 円に直す時の目安。**概算であることを画面にも書く。** 正確な費用は Google の請求画面で見る。 */
export const USD_TO_JPY = 150;

/** 上限に当たった理由と枠の組み合わせ（quota.ts の QuotaReason × Plan）。 */
const LIMIT_REASONS = ['turns', 'images', 'place', 'busy'] as const;
const LIMIT_PLANS = ['guest', 'member'] as const;

export interface Prices {
  /** 送った量 100万トークンあたりの米ドル。 */
  inputPerMTok: number;
  /** 書いた量 100万トークンあたりの米ドル。 */
  outputPerMTok: number;
}

/**
 * モデルの単価。環境変数 GEMINI_PRICE_PER_MTOK に「送る,書く」の順で入れる（例: 2,12）。
 * **単価はモデルや時期で変わるので、コードに書かない。** Google の料金表を見て入れる。
 */
export function pricesFromEnv(env: NodeJS.ProcessEnv = process.env): Prices | null {
  const [input, output] = cleanEnv(env.GEMINI_PRICE_PER_MTOK)
    .split(',')
    .map((part) => Number(part.trim()));
  if (!Number.isFinite(input) || !Number.isFinite(output) || input <= 0 || output <= 0) return null;
  return { inputPerMTok: input, outputPerMTok: output };
}

export function costYen(inputTokens: number, outputTokens: number, prices: Prices): number {
  const usd = (inputTokens / 1_000_000) * prices.inputPerMTok + (outputTokens / 1_000_000) * prices.outputPerMTok;
  return usd * USD_TO_JPY;
}

/** 今日から遡って n 日ぶんの日付（新しい順）。1日の区切りはアプリと同じ深夜2時。 */
export function recentDays(n: number, now: Date = new Date()): string[] {
  const days: string[] = [];
  for (let i = 0; i < n; i += 1) days.push(coachDate(new Date(now.getTime() - i * 86_400_000)));
  // 夏時間などで同じ日が2回出ても、1回にまとめる。
  return [...new Set(days)];
}

/** その日の数を読むのに要る鍵をすべて並べる。 */
export function keysForDay(day: string): string[] {
  return [
    `users:${day}`,
    `turns:${day}:all`,
    `tokens-in:${day}`,
    `tokens-out:${day}`,
    `calls:${day}`,
    `event:${day}:signup`,
    `event:${day}:consent`,
    `event:${day}:import`,
    `event:${day}:push_on`,
    `event:${day}:push_sent`,
    ...LIMIT_REASONS.flatMap((reason) => LIMIT_PLANS.map((plan) => `event:${day}:limit:${reason}:${plan}`)),
  ];
}

export interface DayRow {
  day: string;
  /** その日に1回以上話した人。 */
  users: number;
  /** その日に使い始めた人（はじめてコーチを選んだ人）。 */
  signups: number;
  /** 話した回数。 */
  turns: number;
  /** モデルを呼んだ回数。道具を使うと、1通の返事で何度も呼ぶ。 */
  calls: number;
  /**
   * 1通の返事のために、モデルを何回呼んだか。
   *
   * **単価を下げる時に、いちばん先に見る数。**
   * 呼ぶたびに、固定の指示文と道具の説明（約1.3万トークン）を頭から送り直している。
   * ここが 3 なら、同じ文章を1通のために3回買っている。
   */
  callsPerTurn: number | null;
  inputTokens: number;
  outputTokens: number;
  /** 概算の費用（円）。単価が入っていなければ null。 */
  yen: number | null;
  /** 1人あたりの費用（円）。 */
  yenPerUser: number | null;
  imports: number;
  pushSent: number;
  /** 上限に当たった回数。ゲストと会員を分ける（会員が当たるなら、有料枠の出番）。 */
  limitGuest: number;
  limitMember: number;
}

export function dayRow(day: string, counts: Record<string, number>, prices: Prices | null): DayRow {
  const read = (key: string) => counts[key] ?? 0;
  const inputTokens = read(`tokens-in:${day}`);
  const outputTokens = read(`tokens-out:${day}`);
  const users = read(`users:${day}`);
  const turns = read(`turns:${day}:all`);
  const calls = read(`calls:${day}`);
  const yen = prices ? costYen(inputTokens, outputTokens, prices) : null;
  const limit = (plan: (typeof LIMIT_PLANS)[number]) =>
    LIMIT_REASONS.reduce((sum, reason) => sum + read(`event:${day}:limit:${reason}:${plan}`), 0);
  return {
    day,
    users,
    signups: read(`event:${day}:signup`),
    turns,
    calls,
    callsPerTurn: turns > 0 && calls > 0 ? calls / turns : null,
    inputTokens,
    outputTokens,
    yen,
    yenPerUser: yen !== null && users > 0 ? yen / users : null,
    imports: read(`event:${day}:import`),
    pushSent: read(`event:${day}:push_sent`),
    limitGuest: limit('guest'),
    limitMember: limit('member'),
  };
}

export interface Totals {
  signups: number;
  turns: number;
  /** モデルを呼んだ回数の合計。 */
  calls: number;
  /** 1通の返事あたり、モデルを呼んだ回数。**減らせばそのぶん安くなる。** */
  callsPerTurn: number | null;
  yen: number | null;
  /** 1回話すあたりの費用（円）。**値段を決める一番の材料。** */
  yenPerTurn: number | null;
  limitGuest: number;
  limitMember: number;
}

export function totalsOf(rows: DayRow[]): Totals {
  const sum = (pick: (row: DayRow) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const priced = rows.every((row) => row.yen !== null);
  const yen = priced ? sum((row) => row.yen ?? 0) : null;
  const turns = sum((row) => row.turns);
  const calls = sum((row) => row.calls);
  return {
    signups: sum((row) => row.signups),
    turns,
    calls,
    callsPerTurn: turns > 0 && calls > 0 ? calls / turns : null,
    yen,
    yenPerTurn: yen !== null && turns > 0 ? yen / turns : null,
    limitGuest: sum((row) => row.limitGuest),
    limitMember: sum((row) => row.limitMember),
  };
}
