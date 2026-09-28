/**
 * 1日に使える回数と、使った量の記録。
 *
 * **ここが無いと、URL を知っている誰でも、こちらの財布で好きなだけ話せる。**
 * 1回の返事ごとに、長い指示文・それまでの会話・画像までまとめて送っているので、
 * 1通あたりの単価は安くない。SNS に一度貼られただけで、請求は青天井になる。
 *
 * 数える単位は3つ重ねてある。1つだけでは抜けるため。
 *  - **人ごと**: いちばん普通の使い方を区切る。ログインすると回数が増える
 *  - **場所（IP）ごと**: Cookie を消すたびに新しい人として来る書き方を止める
 *  - **全体**: どんな抜け道があっても、1日の請求がここを超えない
 *
 * 数える仕組みが壊れている時は、**止めずに通す**。
 * 数え損ねた分の費用より、アプリが丸ごと使えなくなる方が困る。
 * その間の最後の歯止めは、Google 側に設定した利用上限。
 */

import { createHash } from 'node:crypto';
import { cleanEnv } from './build-info';
import { coachDate } from './day';

/** どの枠で使っているか。有料の枠は、ここに足せば入る。 */
export type Plan = 'guest' | 'member' | 'admin';

export interface PlanLimits {
  /** 1日に話せる回数。 */
  turns: number;
  /** 1日に送れる画像の枚数。 */
  images: number;
}

/**
 * 枠ごとの上限。
 *
 * ログインしていない人を少なくしてあるのは、**ログインの理由になるから**。
 * 記録がどの端末からでも見られることと合わせて、登録してもらう一押しにする。
 */
export const PLAN_LIMITS: Record<Exclude<Plan, 'admin'>, PlanLimits> = {
  guest: { turns: 15, images: 10 },
  member: { turns: 40, images: 40 },
};

/**
 * 同じ場所から1日に話せる回数。
 * 家族や職場で回線を共有していても、ふつうに使って届かない幅にしてある。
 */
export const PLACE_DAILY_TURNS = 80;

/** アプリ全体で1日に話せる回数。環境変数 DAILY_TURN_BUDGET で変えられる。 */
export const DEFAULT_DAILY_BUDGET = 1000;

/** 数を数える先。key を by だけ増やし、増やした後の値を返す。 */
export interface UsageCounter {
  bumpUsage(key: string, by?: number): Promise<number>;
}

/** 1回の返事で、実際に使った量。 */
export interface Usage {
  /** モデルに送った量（指示文・会話・画像）。 */
  inputTokens: number;
  /** モデルが書いた量（考えた分も含む。どちらも課金される）。 */
  outputTokens: number;
  /** モデルを呼んだ回数。道具を使うと、1回の返事で何度も呼ぶ。 */
  calls: number;
}

export function adminEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  return cleanEnv(env.ADMIN_EMAILS)
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function planFor(
  session: { isAuthenticated?: boolean; email?: string },
  env: NodeJS.ProcessEnv = process.env,
): Plan {
  const email = session.email?.trim().toLowerCase();
  if (session.isAuthenticated && email && adminEmails(env).includes(email)) return 'admin';
  return session.isAuthenticated ? 'member' : 'guest';
}

export function dailyBudget(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(cleanEnv(env.DAILY_TURN_BUDGET));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_DAILY_BUDGET;
}

/**
 * 呼び出し元の場所。Vercel が付ける値を使う（利用者は書き換えられない）。
 * 手元の開発では付かないので、場所の枠は使わない。
 */
export function clientAddress(headers: Headers): string | undefined {
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || undefined;
}

/**
 * IP アドレスは、**そのまま保存しない。**
 * 日付と秘密の値を混ぜて潰すので、元のアドレスにも、別の日の同じ人にも戻せない。
 * 数えるのに要るのは「同じ場所かどうか」だけ。
 */
export function placeId(address: string, day: string, env: NodeJS.ProcessEnv = process.env): string {
  const salt = cleanEnv(env.CRON_SECRET) || cleanEnv(env.SUPABASE_SERVICE_ROLE_KEY) || 'runcoach';
  return createHash('sha256').update(`${salt}:${day}:${address}`).digest('hex').slice(0, 20);
}

export type QuotaReason = 'turns' | 'images' | 'place' | 'busy';

export type QuotaResult =
  | {
      ok: true;
      plan: Plan;
      /** 返事を作れなかった時に、数えた分を戻す。こちらの失敗で回数を減らさない。 */
      release: () => Promise<void>;
    }
  | { ok: false; plan: Plan; reason: QuotaReason; message: string };

/** 断る時の文章。**次に何をすればいいか**まで言う。 */
export function quotaMessage(reason: QuotaReason, plan: Plan): string {
  const limits = plan === 'admin' ? PLAN_LIMITS.member : PLAN_LIMITS[plan];
  switch (reason) {
    case 'turns':
      return plan === 'guest'
        ? `今日はここまでにしましょう。ログインしていない間は、1日${limits.turns}回までです。` +
            `ログインすると1日${PLAN_LIMITS.member.turns}回まで話せて、記録もどの端末からでも見られます。`
        : `今日はここまでにしましょう。1日${limits.turns}回までです。深夜2時を過ぎたら、また話せます。`;
    case 'images':
      return `今日送れる画像の枚数（1日${limits.images}枚）を超えました。文章だけなら、まだ話せます。`;
    case 'place':
      return '同じ回線からの利用が、今日の上限に達しました。深夜2時を過ぎたら、また話せます。';
    case 'busy':
      return '今日はたくさん使われていて、これ以上は話せません。深夜2時を過ぎたら、また話せます。';
  }
}

interface Check {
  key: string;
  by: number;
  /** null は「数えるが止めない」。 */
  limit: number | null;
  reason: QuotaReason;
}

/**
 * 1回ぶんを使ってよいか。
 *
 * **先に数えてから比べる。** 比べてから数えると、同時に来た2通が両方すり抜ける。
 * 断った時は数えた分を戻すので、断られた試みは回数に入らない。
 */
export async function takeQuota(input: {
  counter: UsageCounter;
  plan: Plan;
  userId: string;
  address?: string;
  images: number;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}): Promise<QuotaResult> {
  const { counter, plan, userId, address, images, now = new Date(), env = process.env } = input;
  const day = coachDate(now);
  // 持ち主は止めない。ただし数えはする（費用は費用なので）。
  const limits = plan === 'admin' ? null : PLAN_LIMITS[plan];
  const unlessAdmin = (limit: number) => (plan === 'admin' ? null : limit);

  const checks: Check[] = [
    { key: `turns:${day}:user:${userId}`, by: 1, limit: limits?.turns ?? null, reason: 'turns' },
  ];
  if (images > 0) {
    checks.push({ key: `images:${day}:user:${userId}`, by: images, limit: limits?.images ?? null, reason: 'images' });
  }
  if (address) {
    checks.push({
      key: `turns:${day}:place:${placeId(address, day, env)}`,
      by: 1,
      limit: unlessAdmin(PLACE_DAILY_TURNS),
      reason: 'place',
    });
  }
  checks.push({ key: `turns:${day}:all`, by: 1, limit: unlessAdmin(dailyBudget(env)), reason: 'busy' });

  const settled = await Promise.allSettled(checks.map((check) => counter.bumpUsage(check.key, check.by)));
  if (settled.some((result) => result.status === 'rejected')) {
    const failure = settled.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    console.error('[quota] 回数を数えられませんでした。制限をかけずに通します', failure.reason);
    return { ok: true, plan, release: async () => undefined };
  }
  const counts = settled.map((result) => (result as PromiseFulfilledResult<number>).value);

  const counted = checks.map((check) => ({ key: check.key, by: check.by }));

  // 今日はじめての1回なら、「今日使った人」を1人足す。1人あたりの費用を出す時の分母になる。
  if (counts[0] === 1) {
    try {
      await counter.bumpUsage(`users:${day}`);
      counted.push({ key: `users:${day}`, by: 1 });
    } catch {
      // 人数の集計が欠けても、話すことは止めない。
    }
  }

  const refund = async () => {
    await Promise.allSettled(counted.map((entry) => counter.bumpUsage(entry.key, -entry.by)));
  };

  const over = checks.findIndex((check, index) => check.limit !== null && counts[index] > check.limit);
  if (over !== -1) {
    await refund();
    const reason = checks[over].reason;
    return { ok: false, plan, reason, message: quotaMessage(reason, plan) };
  }

  let released = false;
  return {
    ok: true,
    plan,
    release: async () => {
      if (released) return;
      released = true;
      await refund();
    },
  };
}

/**
 * 実際に使った量を、日ごとに足していく。
 *
 * **値段を決めるには、1人が1か月にいくら使うかが要る。** 見積もりではなく実測で。
 * 失敗しても返事には関係しないので、黙って捨てる。
 */
export async function recordUsage(counter: UsageCounter, usage: Usage, now: Date = new Date()): Promise<void> {
  const day = coachDate(now);
  const entries: [string, number][] = [
    [`tokens-in:${day}`, usage.inputTokens],
    [`tokens-out:${day}`, usage.outputTokens],
    [`calls:${day}`, usage.calls],
  ];
  await Promise.allSettled(
    entries.filter(([, by]) => by > 0).map(([key, by]) => counter.bumpUsage(key, by)),
  );
}

/** 手元の開発や、データベースを使わない時の数え先。プロセスが生きている間だけ覚えている。 */
export class MemoryUsageCounter implements UsageCounter {
  private readonly counts = new Map<string, number>();

  async bumpUsage(key: string, by = 1): Promise<number> {
    const next = (this.counts.get(key) ?? 0) + by;
    this.counts.set(key, next);
    return next;
  }

  /** テスト用。 */
  peek(key: string): number {
    return this.counts.get(key) ?? 0;
  }
}
