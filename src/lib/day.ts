/**
 * 「1日」の区切り。
 *
 * ランナーの1日は、0時では終わらない。
 * 夜10時に走って、風呂に入って、記録をつけるのが日付をまたいだ1時なら、
 * **それは前の日の練習**として数えたい。
 * 0時で切ると、遅い時間に走る人だけが連続日数を落とすことになる。
 *
 * もうひとつ、これは実行環境の時刻で判定してはいけない。
 * サーバーは UTC で動くので、そのまま使うと日本時間では
 * **朝9時に日付が変わる**という、誰の生活とも合わない区切りになる。
 * 走る人の住んでいる場所の時刻で切る。
 */

import { cleanEnv } from './build-info';

/** 何時に次の日へ変わるか。 */
export const DAY_START_HOUR = 2;

/** 既定の地域。日本のランナーを前提にしている。 */
export const DEFAULT_TIME_ZONE = 'Asia/Tokyo';

export function coachTimeZone(env: NodeJS.ProcessEnv = process.env): string {
  return cleanEnv(env.COACH_TIMEZONE) || DEFAULT_TIME_ZONE;
}

/** YYYY-MM-DD を取り出すための整形。en-CA はこの並びで出る。 */
function ymdIn(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    // 知らない地域名が入っていても、日付の計算は止めない。
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: DEFAULT_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }
}

/**
 * いまが「何日」か。
 * 深夜2時を境にする。1時59分はまだ前の日。
 */
export function coachDate(now: Date = new Date(), timeZone: string = coachTimeZone()): string {
  return ymdIn(new Date(now.getTime() - DAY_START_HOUR * 3_600_000), timeZone);
}

/** その地域での曜日（0=日曜）。週のふりかえりを正しい曜日に出すため。 */
export function coachWeekday(now: Date = new Date(), timeZone: string = coachTimeZone()): number {
  const [year, month, day] = coachDate(now, timeZone).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * YYYY-MM-DD を日数ぶん動かす。
 * **文字列のまま UTC で計算する。** 地域や夏時間を持ち込むと、ここで1日ずれる。
 */
export function shiftDay(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return date;
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return ymdIn(moved, 'UTC');
}

/** from から to までの日数。同じ日なら0、未来なら正。 */
export function daysBetween(from: string, to: string): number | undefined {
  const parse = (value: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) return undefined;
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  };
  const a = parse(from);
  const b = parse(to);
  if (a === undefined || b === undefined) return undefined;
  return Math.round((b - a) / 86_400_000);
}

/** 画面に出す一言。区切りが0時でないことは、言わないと伝わらない。 */
export const DAY_BOUNDARY_NOTE = `1日の区切りは深夜${DAY_START_HOUR}時です。夜遅い練習も、その日のぶんとして数えます`;
