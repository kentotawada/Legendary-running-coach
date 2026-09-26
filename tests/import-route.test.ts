import { afterEach, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from '@/app/api/import/route';
import { setStore, type CoachStore } from '@/lib/store';
import { createDefaultProfile, type CoachState } from '@/lib/types';
import type { ImportedWorkout } from '@/lib/workout';

/**
 * 取り込みの入口を、応答の形まで含めて見張る。
 *
 * **ここが抜けていたせいで、同じ壊れ方を二度した。**
 * 一度目は laps / samples / dynamics が whitelist から漏れ、
 * 二度目は upgraded を返し忘れて「差し替えただけの取り込み」が
 * 画面上まるごと失敗に見えた。
 * 数え上げは、1つ残らず返っていることをここで固定する。
 */

const USER = '11111111-2222-3333-4444-555555555555';

function memoryStore(state?: CoachState) {
  let row = state ?? { profile: createDefaultProfile(USER), history: [] };
  const store: CoachStore = {
    load: async () => row,
    save: async (_userId, next) => {
      row = next;
    },
    reset: async () => {
      row = { profile: createDefaultProfile(USER), history: [] };
    },
    adopt: async () => false,
  };
  return { store, read: () => row };
}

function post(workouts: unknown[]): NextRequest {
  const request = new Request('http://localhost/api/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workouts }),
  });
  // NextRequest だけが持つ cookies を、必要なぶんだけ足す。
  return Object.assign(request, {
    cookies: { get: (name: string) => (name === 'rc_uid' ? { name, value: USER } : undefined) },
  }) as unknown as NextRequest;
}

const run = (over: Partial<ImportedWorkout> = {}): ImportedWorkout => ({
  externalId: 'file:2026-09-24T21:10:00Z',
  startedAt: '2026-09-24T21:10:00Z',
  type: 'run',
  source: 'file',
  distanceM: 12000,
  durationSec: 3000,
  avgHr: 158,
  samples: Array.from({ length: 40 }, (_, i) => ({ t: i * 75, d: i * 300, hr: 158 })),
  ...over,
});

/** FIT で入れ直した時の、詳しいほうの1本。 */
const richer = (): ImportedWorkout =>
  run({
    samples: Array.from({ length: 40 }, (_, i) => ({
      t: i * 75,
      d: i * 300,
      hr: 158,
      pace: 250,
      cadence: 89,
      power: 278,
      vo: 9.4,
      gct: 231,
    })),
    dynamics: { powerW: 278, verticalOscillationCm: 9.4, groundContactMs: 231 },
  });

afterEach(() => setStore(null));

describe('POST /api/import', () => {
  it('取り込んだ数を返す', async () => {
    setStore(memoryStore().store);

    const response = await POST(post([run()]));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.imported).toBe(1);
    expect(body.skipped).toBe(0);
    expect(body.upgraded).toBe(0);
    expect(body.dropped).toBe(0);
  });

  it('差し替えただけの取り込みでも、upgraded を返す', async () => {
    // **これを返し忘れると、受け取った側は「何も起きなかった」と読む。**
    setStore(memoryStore().store);
    await POST(post([run()]));

    const response = await POST(post([richer()]));
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.upgraded).toBe(1);
    expect(body.imported).toBe(0);
    expect(typeof body.message).toBe('string');
    expect(body.message).toContain('差し替え');
  });

  it('距離も時間も無い1件は、落とした数に出す', async () => {
    setStore(memoryStore().store);

    const response = await POST(post([run({ distanceM: undefined, durationSec: undefined })]));
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.imported).toBe(0);
    expect(body.dropped).toBe(1);
    expect(body.message).toContain('距離も時間も');
  });

  it('形が合わない時は、取り込み結果とは別の言い方で断る', async () => {
    // 同じ文言だと、どこで落ちたのか画面から分からない。
    setStore(memoryStore().store);

    const response = await POST(post([{ nonsense: true }]));
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain('形が合わず');
  });

  it('取り込んだ記録は、推移もフォームの指標も残っている', async () => {
    const memory = memoryStore();
    setStore(memory.store);

    await POST(post([richer()]));
    const activity = memory.read().profile.activities.at(-1)!;

    expect(activity.series?.gct?.length).toBeGreaterThan(0);
    expect(activity.metrics?.groundContactMs).toBe(231);
  });

  it('接続の鍵は、返す記録に混ぜない', async () => {
    setStore(memoryStore().store);

    const response = await POST(post([run()]));
    const body = (await response.json()) as { profile?: { connections?: unknown } };

    expect(JSON.stringify(body.profile)).not.toContain('accessToken');
    expect(JSON.stringify(body.profile)).not.toContain('refreshToken');
  });
});
