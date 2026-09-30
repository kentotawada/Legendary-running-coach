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

/**
 * 上限に当たった理由と枠の組み合わせ（quota.ts の QuotaReason × Plan）。
 *
 * **本人の上限と、アプリ全体の上限を混ぜないこと。**
 * 混ぜると「会員が上限に当たった＝有料枠の出番」と読むところが、
 * 実際は「全体の財布が尽きて、全員まとめて止まった」かもしれない。
 * 打つ手が正反対（値段を付ける ↔ 予算を上げる）なので、必ず分ける。
 */
const PERSONAL_REASONS = ['turns', 'images', 'place'] as const;
/** アプリ全体の1日の上限（DAILY_TURN_BUDGET）。**当たった人に落ち度は無い。** */
const SHARED_REASON = 'busy';
const LIMIT_PLANS = ['guest', 'member', 'premium'] as const;

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
    `tokens-cached:${day}`,
    `calls:${day}`,
    `event:${day}:open`,
    `event:${day}:signup`,
    `event:${day}:first_turn`,
    `event:${day}:consent`,
    `event:${day}:import`,
    `event:${day}:push_on`,
    `event:${day}:push_sent`,
    `event:${day}:subscribe`,
    `event:${day}:unsubscribe`,
    ...[...PERSONAL_REASONS, SHARED_REASON].flatMap((reason) =>
      LIMIT_PLANS.map((plan) => `event:${day}:limit:${reason}:${plan}`),
    ),
  ];
}

export interface DayRow {
  day: string;
  /** その日に1回以上話した人。 */
  users: number;
  /**
   * その日に**はじめて開いた人**。入口の分母。
   * これが無いと「選んだ人」からしか数えられず、開いて閉じた人が残らない。
   */
  opens: number;
  /** その日に使い始めた人（はじめてコーチを選んだ人）。 */
  signups: number;
  /** その日に**はじめての1通**を送った人。ここまで来て、はじめて使ったことになる。 */
  firstTurns: number;
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
  /** 送った量のうち、前置きの使い回しが効いた分。 */
  cachedTokens: number;
  /**
   * 送った量のうち、使い回せた割合。
   * **指示文の並べ替えが効いたかどうかは、この数でしか分からない。**
   */
  cachedRatio: number | null;
  /** 概算の費用（円）。単価が入っていなければ null。 */
  yen: number | null;
  /** 1人あたりの費用（円）。 */
  yenPerUser: number | null;
  imports: number;
  pushSent: number;
  /**
   * **本人の上限**に当たった回数。ゲストと会員を分ける（会員が当たるなら、有料枠の出番）。
   * アプリ全体の上限で止まった分は、ここに入れない（下の limitShared）。
   */
  limitGuest: number;
  limitMember: number;
  /** 有料の人が上限に当たった数。**ここが増えるなら、枠か値段が合っていない。** */
  limitPremium: number;
  /**
   * **アプリ全体の上限**で止まった回数（DAILY_TURN_BUDGET）。
   *
   * ここが 0 でない日は、**まだ一度も使っていない人まで巻き添えで止まっている。**
   * 打つ手は「値段を付ける」ではなく「予算を上げる」。読み違えるといちばん高くつく。
   */
  limitShared: number;
  /** その日に有料になった人 / やめた人。 */
  subscribed: number;
  unsubscribed: number;
}

export function dayRow(day: string, counts: Record<string, number>, prices: Prices | null): DayRow {
  const read = (key: string) => counts[key] ?? 0;
  const inputTokens = read(`tokens-in:${day}`);
  const outputTokens = read(`tokens-out:${day}`);
  const cachedTokens = read(`tokens-cached:${day}`);
  const users = read(`users:${day}`);
  const turns = read(`turns:${day}:all`);
  const calls = read(`calls:${day}`);
  const yen = prices ? costYen(inputTokens, outputTokens, prices) : null;
  const limit = (plan: (typeof LIMIT_PLANS)[number]) =>
    PERSONAL_REASONS.reduce((sum, reason) => sum + read(`event:${day}:limit:${reason}:${plan}`), 0);
  return {
    day,
    users,
    opens: read(`event:${day}:open`),
    signups: read(`event:${day}:signup`),
    firstTurns: read(`event:${day}:first_turn`),
    turns,
    calls,
    callsPerTurn: turns > 0 && calls > 0 ? calls / turns : null,
    inputTokens,
    outputTokens,
    cachedTokens,
    cachedRatio: inputTokens > 0 ? cachedTokens / inputTokens : null,
    yen,
    yenPerUser: yen !== null && users > 0 ? yen / users : null,
    imports: read(`event:${day}:import`),
    pushSent: read(`event:${day}:push_sent`),
    limitGuest: limit('guest'),
    limitMember: limit('member'),
    limitPremium: limit('premium'),
    limitShared: LIMIT_PLANS.reduce(
      (sum, plan) => sum + read(`event:${day}:limit:${SHARED_REASON}:${plan}`),
      0,
    ),
    subscribed: read(`event:${day}:subscribe`),
    unsubscribed: read(`event:${day}:unsubscribe`),
  };
}

/**
 * 日ごとの「話した人」から、続いているかを読む。
 *
 * **ベータでいちばん知りたいのは、初日の人数ではなく3日目に何人残ったか。**
 * 20人来て3日目に2人なら、それが答え。3人でも1週間続けば、それは本物。
 *
 * 個人を追わずに出す。誰が続けたかは要らない。**何人続いたかが分かればいい。**
 */
export interface Retention {
  /** 直近7日で、1日でも話した人の延べ数（同じ人が別の日に話せば2と数える）。 */
  activeDays: number;
  /** 直近7日のうち、誰かが話した日の数。 */
  daysWithUse: number;
  /** その期間で最も多かった日の人数。 */
  peakUsers: number;
  /** 直近3日に話した人がいるか。**火が消えていないか。** */
  aliveNow: boolean;
}

export function retentionOf(rows: DayRow[]): Retention {
  // rows は新しい順。直近7日だけを見る。
  const week = rows.slice(0, 7);
  return {
    activeDays: week.reduce((sum, row) => sum + row.users, 0),
    daysWithUse: week.filter((row) => row.users > 0).length,
    peakUsers: week.reduce((most, row) => Math.max(most, row.users), 0),
    aliveNow: rows.slice(0, 3).some((row) => row.users > 0),
  };
}

export interface Totals {
  /** はじめて開いた人。入口の分母。 */
  opens: number;
  signups: number;
  /** はじめての1通を送った人。 */
  firstTurns: number;
  turns: number;
  /** モデルを呼んだ回数の合計。 */
  calls: number;
  /** 1通の返事あたり、モデルを呼んだ回数。**減らせばそのぶん安くなる。** */
  callsPerTurn: number | null;
  yen: number | null;
  /** 1回話すあたりの費用（円）。**値段を決める一番の材料。** */
  yenPerTurn: number | null;
  /** 送った量のうち、前置きの使い回しが効いた割合。 */
  cachedRatio: number | null;
  limitGuest: number;
  limitMember: number;
  limitPremium: number;
  /** アプリ全体の上限で止まった回数。**0 でない日は、予算が足りていない。** */
  limitShared: number;
  /** その期間に有料になった人 / やめた人。 */
  subscribed: number;
  unsubscribed: number;
}

export function totalsOf(rows: DayRow[]): Totals {
  const sum = (pick: (row: DayRow) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const priced = rows.every((row) => row.yen !== null);
  const yen = priced ? sum((row) => row.yen ?? 0) : null;
  const turns = sum((row) => row.turns);
  const calls = sum((row) => row.calls);
  const inputTokens = sum((row) => row.inputTokens);
  const cachedTokens = sum((row) => row.cachedTokens);
  return {
    opens: sum((row) => row.opens),
    signups: sum((row) => row.signups),
    firstTurns: sum((row) => row.firstTurns),
    turns,
    calls,
    callsPerTurn: turns > 0 && calls > 0 ? calls / turns : null,
    yen,
    yenPerTurn: yen !== null && turns > 0 ? yen / turns : null,
    cachedRatio: inputTokens > 0 ? cachedTokens / inputTokens : null,
    limitGuest: sum((row) => row.limitGuest),
    limitMember: sum((row) => row.limitMember),
    limitPremium: sum((row) => row.limitPremium),
    limitShared: sum((row) => row.limitShared),
    subscribed: sum((row) => row.subscribed),
    unsubscribed: sum((row) => row.unsubscribed),
  };
}
