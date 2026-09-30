import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DAILY_BUDGET,
  MemoryUsageCounter,
  PLACE_DAILY_TURNS,
  PLAN_LIMITS,
  clientAddress,
  dailyBudget,
  placeId,
  planFor,
  quotaMessage,
  recordUsage,
  takeQuota,
  type Plan,
  type UsageCounter,
} from '@/lib/quota';

/**
 * 1日に使える回数。
 *
 * **ここが抜けると、URL を知っている誰でも、こちらの財布で好きなだけ話せる。**
 * 抜け方は1つではないので、抜け方ごとに確かめる。
 */

const NOW = new Date('2026-09-28T12:00:00+09:00');
/** 環境変数の一部だけを持った入れ物。NODE_ENV などは要らない。 */
const envOf = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;
const ENV = envOf({ CRON_SECRET: 'secret' });

function take(
  counter: UsageCounter,
  over: Partial<{ plan: Plan; userId: string; address: string; images: number; now: Date; env: NodeJS.ProcessEnv }> = {},
) {
  return takeQuota({
    counter,
    plan: over.plan ?? 'guest',
    userId: over.userId ?? 'u1',
    address: over.address,
    images: over.images ?? 0,
    now: over.now ?? NOW,
    env: over.env ?? ENV,
  });
}

async function useUp(counter: UsageCounter, times: number, over: Parameters<typeof take>[1] = {}) {
  const results = [];
  for (let i = 0; i < times; i += 1) results.push(await take(counter, over));
  return results;
}

describe('人ごとの上限', () => {
  it('ログインしていない人は、決めた回数まで話せて、その次で止まる', async () => {
    const counter = new MemoryUsageCounter();
    const results = await useUp(counter, PLAN_LIMITS.guest.turns + 1);
    expect(results.slice(0, -1).every((result) => result.ok)).toBe(true);
    const last = results.at(-1)!;
    expect(last.ok).toBe(false);
    if (!last.ok) {
      expect(last.reason).toBe('turns');
      // **止めるだけでなく、次にどうすればいいかを言う。** ログインが次の一歩。
      expect(last.message).toContain('ログイン');
      expect(last.message).toContain(String(PLAN_LIMITS.member.turns));
    }
  });

  it('ログインしている人は、もっと話せる', async () => {
    const counter = new MemoryUsageCounter();
    const results = await useUp(counter, PLAN_LIMITS.member.turns, { plan: 'member' });
    expect(results.every((result) => result.ok)).toBe(true);
    const next = await take(counter, { plan: 'member' });
    expect(next.ok).toBe(false);
    if (!next.ok) expect(next.message).toContain('深夜2時');
  });

  it('持ち主は止めない', async () => {
    const counter = new MemoryUsageCounter();
    const results = await useUp(counter, PLAN_LIMITS.member.turns * 3, { plan: 'admin' });
    expect(results.every((result) => result.ok)).toBe(true);
  });

  it('別の人の回数には、影響しない', async () => {
    const counter = new MemoryUsageCounter();
    await useUp(counter, PLAN_LIMITS.guest.turns, { userId: 'a' });
    expect((await take(counter, { userId: 'b' })).ok).toBe(true);
  });
});

describe('画像', () => {
  it('画像の上限を超えたら止めるが、文章だけならまだ話せる', async () => {
    const counter = new MemoryUsageCounter();
    expect((await take(counter, { images: PLAN_LIMITS.guest.images })).ok).toBe(true);

    const tooMany = await take(counter, { images: 1 });
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) {
      expect(tooMany.reason).toBe('images');
      expect(tooMany.message).toContain('文章だけなら');
    }

    // 断られた1回は、話した回数にも数えない。だから文章は送れる。
    expect((await take(counter)).ok).toBe(true);
  });
});

describe('Cookie を消して別人として来る書き方', () => {
  /**
   * **人ごとの上限だけでは、ここが抜ける。**
   * Cookie を持たずに来ると、毎回新しい人として扱われるので、人ごとの回数はずっと1のまま。
   */
  it('毎回違う人でも、同じ回線からなら止まる', async () => {
    const counter = new MemoryUsageCounter();
    const results = [];
    for (let i = 0; i < PLACE_DAILY_TURNS + 1; i += 1) {
      results.push(await take(counter, { userId: `fresh-${i}`, address: '203.0.113.7' }));
    }
    expect(results.slice(0, -1).every((result) => result.ok)).toBe(true);
    const last = results.at(-1)!;
    expect(last.ok).toBe(false);
    if (!last.ok) expect(last.reason).toBe('place');
  });

  it('別の回線の人は、巻き添えにならない', async () => {
    const counter = new MemoryUsageCounter();
    for (let i = 0; i < PLACE_DAILY_TURNS; i += 1) {
      await take(counter, { userId: `fresh-${i}`, address: '203.0.113.7' });
    }
    expect((await take(counter, { userId: 'neighbour', address: '198.51.100.2' })).ok).toBe(true);
  });
});

describe('アプリ全体の上限', () => {
  it('どんな抜け道があっても、1日の合計はここを超えない', async () => {
    const counter = new MemoryUsageCounter();
    const env = envOf({ CRON_SECRET: 'secret', DAILY_TURN_BUDGET: '5' });
    const results = [];
    for (let i = 0; i < 6; i += 1) {
      results.push(await take(counter, { userId: `u${i}`, address: `192.0.2.${i}`, env }));
    }
    expect(results.slice(0, 5).every((result) => result.ok)).toBe(true);
    const last = results[5];
    expect(last.ok).toBe(false);
    if (!last.ok) expect(last.reason).toBe('busy');
  });

  /**
   * **当たった人に落ち度は無い。**
   *
   * 全体の枠を使い切った状態では、まだ一度も話していない人にも同じ文が出る。
   * 「使いすぎです」と読める文面だと、自分のせいだと思って静かに離れる。
   * 本人の上限の文面と、はっきり書き分ける。
   */
  describe('止まった時の文面', () => {
    const shared = quotaMessage('busy', 'member');

    it('本人の上限ではないと、はっきり言う', () => {
      expect(shared).toContain('こちらの都合');
      expect(shared).toContain('あなたの回数はまだ残っています');
    });

    it('使いすぎだと読める言い方をしない', () => {
      expect(shared).not.toContain('ここまでにしましょう');
      expect(shared).not.toMatch(/使いすぎ|上限です/);
    });

    it('記録が無事なことを添える（消えたと思わせない）', () => {
      expect(shared).toContain('記録は消えていない');
    });

    it('いつ戻れるかを言う', () => {
      expect(shared).toContain('深夜2時');
    });

    it('どの枠の人にも、同じ文が出る（全体の枠なので）', () => {
      for (const plan of ['guest', 'member', 'premium'] as Plan[]) {
        expect(quotaMessage('busy', plan)).toBe(shared);
      }
    });

    it('本人の上限とは、別の文になっている', () => {
      expect(quotaMessage('turns', 'member')).not.toBe(shared);
      expect(quotaMessage('turns', 'member')).toContain('ここまでにしましょう');
    });
  });

  it('設定が無ければ既定値、おかしな値でも既定値', () => {
    expect(dailyBudget(envOf({}))).toBe(DEFAULT_DAILY_BUDGET);
    expect(dailyBudget(envOf({ DAILY_TURN_BUDGET: 'abc' }))).toBe(DEFAULT_DAILY_BUDGET);
    expect(dailyBudget(envOf({ DAILY_TURN_BUDGET: '-3' }))).toBe(DEFAULT_DAILY_BUDGET);
    expect(dailyBudget(envOf({ DAILY_TURN_BUDGET: '300' }))).toBe(300);
  });
});

describe('同時に来ても、すり抜けない', () => {
  /**
   * **比べてから数えると、ここが抜ける。** 2通が同時に「まだ14回」を読んで、両方通る。
   * 先に数えてから比べる作りなので、何通同時に来ても上限ちょうどで止まる。
   */
  it('20通同時に来ても、通るのは上限の数だけ', async () => {
    const counter = new MemoryUsageCounter();
    const results = await Promise.all(Array.from({ length: 20 }, () => take(counter)));
    expect(results.filter((result) => result.ok)).toHaveLength(PLAN_LIMITS.guest.turns);
  });
});

describe('断った分・失敗した分は、数えない', () => {
  it('断られた試みは、回数に残らない', async () => {
    const counter = new MemoryUsageCounter();
    await useUp(counter, PLAN_LIMITS.guest.turns + 5);
    expect(counter.peek('turns:2026-09-28:user:u1')).toBe(PLAN_LIMITS.guest.turns);
  });

  it('返事を作れなかった時は、使った1回を戻す', async () => {
    const counter = new MemoryUsageCounter();
    const result = await take(counter, { images: 3 });
    expect(result.ok).toBe(true);
    if (result.ok) await result.release();
    expect(counter.peek('turns:2026-09-28:user:u1')).toBe(0);
    expect(counter.peek('images:2026-09-28:user:u1')).toBe(0);
    expect(counter.peek('turns:2026-09-28:all')).toBe(0);
    expect(counter.peek('users:2026-09-28')).toBe(0);
  });

  it('二度戻しても、二重には戻らない', async () => {
    const counter = new MemoryUsageCounter();
    await take(counter);
    const result = await take(counter);
    if (result.ok) {
      await result.release();
      await result.release();
    }
    expect(counter.peek('turns:2026-09-28:user:u1')).toBe(1);
  });
});

describe('日の変わり目', () => {
  it('深夜2時を過ぎたら、また話せる', async () => {
    const counter = new MemoryUsageCounter();
    const late = new Date('2026-09-29T01:30:00+09:00');
    await useUp(counter, PLAN_LIMITS.guest.turns, { now: late });
    // 1時半はまだ前の日。
    expect((await take(counter, { now: late })).ok).toBe(false);
    // 2時を過ぎると新しい日。
    expect((await take(counter, { now: new Date('2026-09-29T02:05:00+09:00') })).ok).toBe(true);
  });
});

describe('数える仕組みが壊れている時', () => {
  /** **止めずに通す。** 数え損ねた分の費用より、アプリごと使えなくなる方が困る。 */
  it('数えられなくても、話すことは止めない', async () => {
    const broken: UsageCounter = {
      bumpUsage: async () => {
        throw new Error('function bump_usage does not exist');
      },
    };
    const result = await take(broken);
    expect(result.ok).toBe(true);
  });
});

describe('IP アドレスは、そのまま残さない', () => {
  it('数えるための鍵に、元のアドレスが入らない', async () => {
    const counter = new MemoryUsageCounter();
    const keys: string[] = [];
    const spy: UsageCounter = {
      bumpUsage: (key, by) => {
        keys.push(key);
        return counter.bumpUsage(key, by);
      },
    };
    await take(spy, { address: '203.0.113.7' });
    expect(keys.some((key) => key.includes('203.0.113.7'))).toBe(false);
    expect(keys.some((key) => key.includes(':place:'))).toBe(true);
  });

  it('日が変われば別の値になる（日をまたいで同じ人を追えない）', () => {
    expect(placeId('203.0.113.7', '2026-09-28', ENV)).not.toBe(placeId('203.0.113.7', '2026-09-29', ENV));
    expect(placeId('203.0.113.7', '2026-09-28', ENV)).toBe(placeId('203.0.113.7', '2026-09-28', ENV));
  });

  it('Vercel が付けた値から、呼び出し元を読む', () => {
    expect(clientAddress(new Headers({ 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7');
    expect(clientAddress(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
    expect(clientAddress(new Headers())).toBeUndefined();
  });
});

describe('どの枠で使っているか', () => {
  const env = envOf({ ADMIN_EMAILS: 'Owner@Example.com, other@example.com' });

  it('ログインしていなければゲスト、していれば会員', () => {
    expect(planFor({ isAuthenticated: false }, env)).toBe('guest');
    expect(planFor({ isAuthenticated: true, email: 'someone@example.com' }, env)).toBe('member');
  });

  it('持ち主のアドレスなら、大文字小文字を問わず持ち主', () => {
    expect(planFor({ isAuthenticated: true, email: 'owner@example.com' }, env)).toBe('admin');
  });

  /** ログインしていないのにメールだけ名乗っても、持ち主にはならない。 */
  it('ログインしていなければ、アドレスが一致しても持ち主にしない', () => {
    expect(planFor({ isAuthenticated: false, email: 'owner@example.com' }, env)).toBe('guest');
  });
});

describe('使った量の記録', () => {
  it('日ごとに足していく（値段を決めるための実測）', async () => {
    const counter = new MemoryUsageCounter();
    await recordUsage(counter, { inputTokens: 9000, outputTokens: 700, cachedTokens: 6000, calls: 2 }, NOW);
    await recordUsage(counter, { inputTokens: 1000, outputTokens: 300, cachedTokens: 0, calls: 1 }, NOW);
    expect(counter.peek('tokens-in:2026-09-28')).toBe(10000);
    expect(counter.peek('tokens-out:2026-09-28')).toBe(1000);
    expect(counter.peek('calls:2026-09-28')).toBe(3);
  });

  /**
   * 前置きの使い回しが効いた量。
   * **効いているかどうかは、この数でしか分からない。**
   */
  it('使い回せた量も、日ごとに足す', async () => {
    const counter = new MemoryUsageCounter();
    await recordUsage(counter, { inputTokens: 9000, outputTokens: 700, cachedTokens: 6000, calls: 2 }, NOW);
    await recordUsage(counter, { inputTokens: 9000, outputTokens: 300, cachedTokens: 5500, calls: 1 }, NOW);
    expect(counter.peek('tokens-cached:2026-09-28')).toBe(11500);
  });

  /** 使い回しが効かなかった日を、0として残す（数えていないのと区別する必要は無い）。 */
  it('使い回せた量が0なら、書き込まない', async () => {
    const counter = new MemoryUsageCounter();
    await recordUsage(counter, { inputTokens: 9000, outputTokens: 700, cachedTokens: 0, calls: 1 }, NOW);
    expect(counter.peek('tokens-cached:2026-09-28')).toBe(0);
  });

  it('その日の最初の1回だけ、使った人を1人足す（1人あたりの費用の分母）', async () => {
    const counter = new MemoryUsageCounter();
    await useUp(counter, 3, { userId: 'a' });
    await useUp(counter, 2, { userId: 'b' });
    expect(counter.peek('users:2026-09-28')).toBe(2);
  });
});
