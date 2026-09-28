import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from '@/app/api/feedback/route';
import { MemoryOpsLog, setOps } from '@/lib/ops';
import { MemoryUsageCounter } from '@/lib/quota';
import { setStore, type CoachStore } from '@/lib/store';
import { createDefaultProfile, type CoachState } from '@/lib/types';
import { withConsent } from '@/lib/legal';

/**
 * 返答への「良い・良くない」。
 *
 * **これまで、押しても端末の中で消えていた。** どの返答が外したのかを、持ち主は知る手段が無かった。
 * 押し直しや理由の追記で記録が増えていくと、同じ1件が何件にも見えて数を読み違える。
 */

const USER = '11111111-2222-3333-4444-555555555555';
let ops: MemoryOpsLog;
let usage: MemoryUsageCounter;

function send(body: unknown, user = USER) {
  const request = new Request('http://localhost/api/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.5' },
    body: JSON.stringify(body),
  });
  return POST(
    Object.assign(request, {
      cookies: { get: (name: string) => (name === 'rc_uid' ? { name, value: user } : undefined) },
    }) as unknown as NextRequest,
  );
}

beforeEach(() => {
  usage = new MemoryUsageCounter();
  ops = new MemoryOpsLog(usage);
  let row: CoachState = {
    profile: { ...withConsent(createDefaultProfile(USER)), characterId: 'logic' },
    history: [],
  };
  const store: CoachStore = {
    load: async () => row,
    save: async (_id, next) => {
      row = next;
    },
    reset: async () => undefined,
    adopt: async () => false,
    bumpUsage: (key, by) => usage.bumpUsage(key, by),
  };
  setStore(store);
  setOps(ops);
});

afterEach(() => {
  setStore(null);
  setOps(null);
});

const REPLY = '今日の閾値走、狙いは成立しています。後半3kmで心拍が8拍上がりました。';

describe('評価を持ち主に届ける', () => {
  it('評価・返答の文面・コーチを残す', async () => {
    expect((await send({ rating: 'good', reply: REPLY })).status).toBe(200);
    const [item] = await ops.recent('feedback', 5);
    expect(item.payload.rating).toBe('good');
    expect(item.payload.reply).toBe(REPLY);
    expect(item.payload.coach).toBe('白石 遼');
    expect(item.userId).toBe(USER);
  });

  /** プライバシーポリシーに書いた範囲だけを残す。利用者が書いた文章は受け取っても残さない。 */
  it('決めた項目以外は残さない', async () => {
    await send({ rating: 'bad', reply: REPLY, question: '右膝が痛いけど走っていい？' });
    const [item] = await ops.recent('feedback', 5);
    expect(Object.keys(item.payload).sort()).toEqual(['coach', 'plan', 'rating', 'reply']);
    expect(JSON.stringify(item)).not.toContain('右膝');
  });
});

describe('押し直しても、1件のまま', () => {
  it('「良くない」のあとに理由を足すと、同じ1件に理由が入る', async () => {
    await send({ rating: 'bad', reply: REPLY });
    await send({ rating: 'bad', reason: '自分に合っていない', reply: REPLY });
    const items = await ops.recent('feedback', 10);
    expect(items).toHaveLength(1);
    expect(items[0].payload.reason).toBe('自分に合っていない');
  });

  it('「良い」から「良くない」に押し直すと、書き換わる', async () => {
    await send({ rating: 'good', reply: REPLY });
    await send({ rating: 'bad', reply: REPLY });
    const items = await ops.recent('feedback', 10);
    expect(items).toHaveLength(1);
    expect(items[0].payload.rating).toBe('bad');
  });

  it('違う返答なら、別の1件', async () => {
    await send({ rating: 'good', reply: REPLY });
    await send({ rating: 'bad', reply: '明日は休みましょう。' });
    expect(await ops.recent('feedback', 10)).toHaveLength(2);
  });

  it('別の人が同じ返答を評価したら、別の1件', async () => {
    await send({ rating: 'good', reply: REPLY });
    await send({ rating: 'good', reply: REPLY }, '99999999-2222-3333-4444-555555555555');
    expect(await ops.recent('feedback', 10)).toHaveLength(2);
  });
});

describe('受け取らないもの', () => {
  it('評価の値が違う・返答が空なら、受け取らない', async () => {
    expect((await send({ rating: 'meh', reply: REPLY })).status).toBe(400);
    expect((await send({ rating: 'good', reply: '   ' })).status).toBe(400);
    expect(await ops.recent('feedback', 10)).toHaveLength(0);
  });

  it('理由は長さを切る', async () => {
    await send({ rating: 'bad', reason: 'あ'.repeat(1000), reply: REPLY });
    const [item] = await ops.recent('feedback', 5);
    expect((item.payload.reason as string).length).toBe(300);
  });

  it('1人の連打は、途中から受け付けない', async () => {
    for (let i = 0; i < 205; i += 1) await send({ rating: 'good', reply: `返答 ${i}` });
    expect(await ops.recent('feedback', 500)).toHaveLength(200);
  });
});
