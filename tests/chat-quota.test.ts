import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { MemoryUsageCounter, PLAN_LIMITS } from '@/lib/quota';
import { setStore, type CoachStore } from '@/lib/store';
import { createDefaultProfile, type CoachState } from '@/lib/types';
import { coachDate } from '@/lib/day';
import { withConsent } from '@/lib/legal';

/**
 * 1日の上限が、チャットの入口で本当に効いているか。
 *
 * quota.ts が正しくても、入口でつなぎ忘れれば上限は無いのと同じ。
 * **モデルは呼ばずに**（お金がかかるので）、呼ばれたかどうかと、断った時の応答を見る。
 */

const runCoachTurn = vi.fn();

vi.mock('@/lib/gemini', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/gemini')>()),
  runCoachTurn: (...args: unknown[]) => runCoachTurn(...args),
}));

const { POST } = await import('@/app/api/chat/route');

const USER = '11111111-2222-3333-4444-555555555555';

function memoryStore(consented = true) {
  const profile = createDefaultProfile(USER);
  let row: CoachState = { profile: consented ? withConsent(profile) : profile, history: [] };
  const usage = new MemoryUsageCounter();
  const store: CoachStore = {
    load: async () => row,
    save: async (_userId, next) => {
      row = next;
    },
    reset: async () => undefined,
    adopt: async () => false,
    bumpUsage: (key, by) => usage.bumpUsage(key, by),
  };
  return { store, usage };
}

function post(message: string): NextRequest {
  const request = new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.7' },
    body: JSON.stringify({ message }),
  });
  return Object.assign(request, {
    cookies: { get: (name: string) => (name === 'rc_uid' ? { name, value: USER } : undefined) },
  }) as unknown as NextRequest;
}

/** 流れてくる行を最後まで読む。読み切らないと、保存や記録が終わる前にテストが進む。 */
async function send(message: string) {
  const response = await POST(post(message));
  const body = await response.text();
  return { status: response.status, body };
}

const reply = (state: CoachState) => ({
  state,
  text: 'はい。',
  rewrites: 0,
  usedTools: [],
  usage: { inputTokens: 9000, outputTokens: 400, calls: 1 },
});

let memory: ReturnType<typeof memoryStore>;
const today = () => coachDate(new Date());

beforeEach(() => {
  memory = memoryStore();
  setStore(memory.store);
  runCoachTurn.mockReset();
  runCoachTurn.mockImplementation(async ({ state }: { state: CoachState }) => reply(state));
});

afterEach(() => {
  setStore(null);
});

describe('チャットの入口で、1日の上限が効いている', () => {
  it('上限を超えたら、モデルを呼ばずに断る', async () => {
    for (let i = 0; i < PLAN_LIMITS.guest.turns; i += 1) {
      expect((await send('今日は10km')).status).toBe(200);
    }
    expect(runCoachTurn).toHaveBeenCalledTimes(PLAN_LIMITS.guest.turns);

    const refused = await send('もう1回');
    expect(refused.status).toBe(429);
    // **呼ばない。** 呼んでから断っても、費用はもうかかっている。
    expect(runCoachTurn).toHaveBeenCalledTimes(PLAN_LIMITS.guest.turns);
    // 画面にはこちらの文章がそのまま出る（transport-error.ts が error を拾う）。
    expect(JSON.parse(refused.body).error).toContain('ログイン');
  });

  it('こちらの失敗で返事が出せなかった時は、回数を減らさない', async () => {
    runCoachTurn.mockRejectedValue(new Error('model down'));
    for (let i = 0; i < 5; i += 1) await send('届かない');
    expect(memory.usage.peek(`turns:${today()}:user:${USER}`)).toBe(0);
    expect(memory.usage.peek(`turns:${today()}:all`)).toBe(0);

    // 直ったあとは、上限いっぱいまで話せる。
    runCoachTurn.mockImplementation(async ({ state }: { state: CoachState }) => reply(state));
    for (let i = 0; i < PLAN_LIMITS.guest.turns; i += 1) {
      expect((await send('今日は10km')).status).toBe(200);
    }
  });

  it('使った量が、日ごとに残る', async () => {
    await send('今日は10km');
    await send('明日は休み');
    expect(memory.usage.peek(`tokens-in:${today()}`)).toBe(18000);
    expect(memory.usage.peek(`tokens-out:${today()}`)).toBe(800);
    expect(memory.usage.peek(`users:${today()}`)).toBe(1);
  });
});

describe('同意していない人', () => {
  it('モデルを呼ばずに断り、回数も減らさない', async () => {
    memory = memoryStore(false);
    setStore(memory.store);
    const response = await send('今日は10km');
    expect(response.body).toContain('同意');
    expect(runCoachTurn).not.toHaveBeenCalled();
    // 断った1回は、数えない。
    expect(memory.usage.peek(`turns:${today()}:user:${USER}`)).toBe(0);
  });
});
