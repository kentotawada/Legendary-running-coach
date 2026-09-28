import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { costYen, dayRow, keysForDay, pricesFromEnv, recentDays, totalsOf, USD_TO_JPY } from '@/lib/admin';
import { MemoryOpsLog, clip, countEvent, reportError, setOps } from '@/lib/ops';
import { MemoryUsageCounter } from '@/lib/quota';
import { setStore, type CoachStore } from '@/lib/store';
import { createDefaultProfile, type CoachState } from '@/lib/types';
import { withConsent } from '@/lib/legal';
import { coachDate } from '@/lib/day';
import { PATCH as patchProfile } from '@/app/api/profile/route';
import { POST as postReport } from '@/app/api/report/route';
import { POST as postImport } from '@/app/api/import/route';

/**
 * 運営の記録。持ち主だけが /admin で見る。
 *
 * **事業として回すには、見えていないといけない。** 何人来たか、いくらかかったか、
 * どこで壊れたか、無料の上限に何人が当たったか。数え方を間違えると、判断を間違える。
 */

const envOf = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;
const NOW = new Date('2026-09-28T12:00:00+09:00');

describe('費用の計算', () => {
  it('単価は「送る,書く」の順で読む', () => {
    expect(pricesFromEnv(envOf({ GEMINI_PRICE_PER_MTOK: '2,12' }))).toEqual({ inputPerMTok: 2, outputPerMTok: 12 });
    expect(pricesFromEnv(envOf({ GEMINI_PRICE_PER_MTOK: ' 1.25 , 10 ' }))).toEqual({ inputPerMTok: 1.25, outputPerMTok: 10 });
  });

  /** 間違った単価で計算した費用を出すくらいなら、出さない。 */
  it('読めない単価なら、費用を出さない', () => {
    for (const value of ['', '2', 'abc,def', '0,12', '-1,12']) {
      expect(pricesFromEnv(envOf({ GEMINI_PRICE_PER_MTOK: value }))).toBeNull();
    }
  });

  it('トークンから円に直す', () => {
    // 送る 100万 × 2ドル + 書く 10万 × 12ドル = 3.2ドル
    expect(costYen(1_000_000, 100_000, { inputPerMTok: 2, outputPerMTok: 12 })).toBeCloseTo(3.2 * USD_TO_JPY);
  });
});

describe('日ごとの数', () => {
  const day = '2026-09-28';
  const counts = {
    [`users:${day}`]: 4,
    [`turns:${day}:all`]: 30,
    [`calls:${day}`]: 90,
    [`tokens-in:${day}`]: 300_000,
    [`tokens-out:${day}`]: 20_000,
    [`event:${day}:signup`]: 2,
    [`event:${day}:import`]: 1,
    [`event:${day}:push_sent`]: 3,
    [`event:${day}:limit:turns:guest`]: 5,
    [`event:${day}:limit:images:guest`]: 1,
    [`event:${day}:limit:turns:member`]: 2,
  };

  it('上限に当たった数を、ゲストと会員に分けて足す', () => {
    const row = dayRow(day, counts, null);
    expect(row.limitGuest).toBe(6);
    expect(row.limitMember).toBe(2);
  });

  it('単価があれば、1人あたりの費用を出す', () => {
    const row = dayRow(day, counts, { inputPerMTok: 2, outputPerMTok: 12 });
    // 0.3 × 2 + 0.02 × 12 = 0.84ドル
    expect(row.yen).toBeCloseTo(0.84 * USD_TO_JPY);
    expect(row.yenPerUser).toBeCloseTo((0.84 * USD_TO_JPY) / 4);
  });

  it('単価が無ければ、費用は空欄（0円と出さない）', () => {
    const row = dayRow(day, counts, null);
    expect(row.yen).toBeNull();
    expect(totalsOf([row]).yen).toBeNull();
  });

  it('1回あたりの費用を、期間全体で出す（値段を決める一番の材料）', () => {
    const totals = totalsOf([dayRow(day, counts, { inputPerMTok: 2, outputPerMTok: 12 })]);
    expect(totals.yenPerTurn).toBeCloseTo((0.84 * USD_TO_JPY) / 30);
  });

  /**
   * 1通のためにモデルを何回呼んだか。
   *
   * **単価を下げる時に、いちばん先に見る数。** 呼ぶたびに、固定の指示文と道具の説明
   * （約1.3万トークン）を頭から送り直している。3回なら、同じ文章を3回買っている。
   */
  it('1通あたり、モデルを何回呼んだかを出す', () => {
    expect(dayRow(day, counts, null).callsPerTurn).toBe(3);
    expect(totalsOf([dayRow(day, counts, null)]).callsPerTurn).toBe(3);
  });

  /** 数えていない日を「0回で済んだ」と読み違えさせない。 */
  it('呼んだ回数を数えていなければ、空欄にする（0回と出さない）', () => {
    const row = dayRow(day, { [`turns:${day}:all`]: 30 }, null);
    expect(row.calls).toBe(0);
    expect(row.callsPerTurn).toBeNull();
  });

  it('まだ誰も話していない日は、1通あたりを出さない', () => {
    expect(dayRow(day, {}, null).callsPerTurn).toBeNull();
    expect(totalsOf([dayRow(day, {}, null)]).callsPerTurn).toBeNull();
  });

  it('読む鍵に、上限の組み合わせがすべて入っている', () => {
    const keys = keysForDay(day);
    for (const reason of ['turns', 'images', 'place', 'busy']) {
      for (const plan of ['guest', 'member']) expect(keys).toContain(`event:${day}:limit:${reason}:${plan}`);
    }
  });

  it('日付は、アプリと同じく深夜2時で区切る', () => {
    // 9/29 の 1時半は、まだ 9/28。
    const days = recentDays(3, new Date('2026-09-29T01:30:00+09:00'));
    expect(days).toEqual(['2026-09-28', '2026-09-27', '2026-09-26']);
  });
});

describe('不具合を残す', () => {
  afterEach(() => setOps(null));

  it('どこで・何が起きたかを残す', async () => {
    const ops = new MemoryOpsLog();
    setOps(ops);
    await reportError('chat:model', new Error('quota exceeded'), { userId: 'u1' });
    const [event] = await ops.recent('error', 5);
    expect(event.userId).toBe('u1');
    expect(event.payload.where).toBe('chat:model');
    expect(event.payload.message).toContain('quota exceeded');
  });

  /** 記録のための記録で、利用者の画面を壊さない。 */
  it('残せなくても、例外を投げない', async () => {
    setOps({
      record: async () => {
        throw new Error('table missing');
      },
      recent: async () => [],
      counts: async () => ({}),
    });
    await expect(reportError('chat:model', new Error('x'))).resolves.toBeUndefined();
  });

  it('長すぎる中身は切り詰める（表を膨らませない）', () => {
    const clipped = clip({ message: 'あ'.repeat(10_000), nested: { deep: 'x'.repeat(10_000) } });
    expect((clipped.message as string).length).toBe(2000);
    expect((clipped.nested as string).length).toBe(2000);
  });
});

describe('出来事を数える', () => {
  it('日付つきの鍵で数える', async () => {
    const counter = new MemoryUsageCounter();
    await countEvent(counter, 'signup', 1, NOW);
    await countEvent(counter, 'push_sent', 3, NOW);
    expect(counter.peek('event:2026-09-28:signup')).toBe(1);
    expect(counter.peek('event:2026-09-28:push_sent')).toBe(3);
  });

  it('0 件なら数えない。数える先が無くても落ちない', async () => {
    const counter = new MemoryUsageCounter();
    await countEvent(counter, 'push_sent', 0, NOW);
    expect(counter.peek('event:2026-09-28:push_sent')).toBe(0);
    await expect(countEvent(undefined, 'signup')).resolves.toBeUndefined();
  });
});

describe('入口ごとの記録', () => {
  const USER = '11111111-2222-3333-4444-555555555555';
  let usage: MemoryUsageCounter;
  let ops: MemoryOpsLog;
  let row: CoachState;

  function request(url: string, method: string, body: unknown, headers: Record<string, string> = {}) {
    const raw = new Request(url, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return Object.assign(raw, {
      cookies: { get: (name: string) => (name === 'rc_uid' ? { name, value: USER } : undefined) },
    }) as unknown as NextRequest;
  }

  beforeEach(() => {
    usage = new MemoryUsageCounter();
    ops = new MemoryOpsLog(usage);
    row = { profile: createDefaultProfile(USER), history: [] };
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

  it('はじめてコーチを選んだ時だけ「使い始めた」を数える。同意も一度だけ', async () => {
    await patchProfile(request('http://localhost/api/profile', 'PATCH', { characterId: 'logic', consent: true }));
    // 2回目: コーチを変えても、同意し直しても、使い始めた人は増えない。
    await patchProfile(request('http://localhost/api/profile', 'PATCH', { characterId: 'blaze', consent: true }));
    const day = coachDate();
    expect(usage.peek(`event:${day}:signup`)).toBe(1);
    expect(usage.peek(`event:${day}:consent`)).toBe(1);
  });

  it('画面からの不具合の報告を受け取り、同じ回線からの連打は途中で止める', async () => {
    for (let i = 0; i < 40; i += 1) {
      await postReport(
        request('http://localhost/api/report', 'POST', { message: `TypeError ${i}` }, { 'x-real-ip': '203.0.113.9' }),
      );
    }
    const recorded = await ops.recent('error', 100);
    expect(recorded.length).toBe(30);
    expect(recorded[0].payload.where).toBe('browser');
  });

  it('空の報告は、残さない', async () => {
    await postReport(request('http://localhost/api/report', 'POST', { message: '   ' }));
    expect(await ops.recent('error', 5)).toHaveLength(0);
  });

  it('取り込めた時に「取り込み」を数える', async () => {
    row = { profile: withConsent(createDefaultProfile(USER)), history: [] };
    await postImport(
      request('http://localhost/api/import', 'POST', {
        workouts: [
          {
            externalId: 'file:x',
            startedAt: '2026-09-24T21:10:00Z',
            type: 'run',
            source: 'file',
            distanceM: 8000,
            durationSec: 2400,
          },
        ],
      }),
    );
    expect(usage.peek(`event:${coachDate()}:import`)).toBe(1);
  });
});
