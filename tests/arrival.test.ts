import { describe, expect, it, vi } from 'vitest';
import { receiveStravaEvent } from '@/lib/arrival';
import type { StravaEvent } from '@/lib/strava-webhook';
import { createDefaultProfile } from '@/lib/types';
import type { PushSubscriptionRecord, RunnerProfile } from '@/lib/types';

/**
 * 届いた通知を、カルテへ反映するところ。
 *
 * **本人が見ていない時間に動く層。** 間違えた時に「やり直してください」と言う相手がいない。
 * 守るのは、持っているものを壊さないこと。
 */

const NOW = new Date('2026-10-01T09:00:00+09:00');
const env = { STRAVA_CLIENT_ID: '1', STRAVA_CLIENT_SECRET: 'secret-xyz' } as unknown as NodeJS.ProcessEnv;

const SUBSCRIPTION: PushSubscriptionRecord = {
  endpoint: 'https://push.example/a',
  keys: { p256dh: 'p', auth: 'a' },
  createdAt: '2026-09-01T00:00:00.000Z',
};

function connected(extra: Partial<RunnerProfile> = {}): RunnerProfile {
  return {
    ...createDefaultProfile('u1', '2026-06-01T00:00:00.000Z'),
    displayName: '健太',
    characterId: 'logic',
    connections: {
      strava: {
        athleteId: 7,
        connectedAt: '2026-09-01T00:00:00.000Z',
        imported: 0,
        secret: {
          accessToken: 'at',
          refreshToken: 'rt',
          expiresAt: Math.floor(NOW.getTime() / 1000) + 7200,
        },
      },
    },
    ...extra,
  };
}

/** listProfiles / saveProfile だけを持つ、偽の保存先。 */
function store(people: { userId: string; profile: RunnerProfile }[]) {
  const saved: { userId: string; profile: RunnerProfile }[] = [];
  return {
    saved,
    listProfiles: vi.fn(async () => people),
    saveProfile: vi.fn(async (userId: string, profile: RunnerProfile) => {
      saved.push({ userId, profile });
    }),
  };
}

const activity = (id: number, date: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: 'Morning Run',
  sport_type: 'Run',
  start_date_local: `${date}T06:00:00Z`,
  distance: 20000,
  moving_time: 6600,
  average_heartrate: 148,
  ...extra,
});

/** Strava の一覧だけを返す窓口。 */
function strava(items: unknown[]) {
  return vi.fn(async (url: string) => {
    if (String(url).includes('/gear/')) {
      return { ok: true, status: 200, text: async () => '{}' } as unknown as Response;
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(items) } as unknown as Response;
  });
}

const event = (overrides: Partial<StravaEvent> = {}): StravaEvent => ({
  objectType: 'activity',
  aspectType: 'create',
  objectId: 12345,
  ownerId: 7,
  subscriberId: 99,
  ...overrides,
});

describe('誰の通知か', () => {
  it('持ち主が見つからなければ、何もしない', async () => {
    const fake = store([{ userId: 'u2', profile: createDefaultProfile('u2') }]);
    const result = await receiveStravaEvent(event(), { store: fake, now: NOW, env });

    expect(result.matched).toBe(false);
    expect(result.reason).toBe('unknown-athlete');
    expect(fake.saveProfile).not.toHaveBeenCalled();
  });

  it('athleteId で持ち主を見分ける', async () => {
    const fake = store([
      { userId: 'other', profile: createDefaultProfile('other') },
      { userId: 'u1', profile: connected() },
    ]);
    const result = await receiveStravaEvent(event(), {
      store: fake,
      now: NOW,
      env,
      fetchImpl: strava([activity(12345, '2026-10-01')]) as never,
    });

    expect(result.matched).toBe(true);
    expect(fake.saved[0].userId).toBe('u1');
  });

  it('一覧を持たない保存先では、黙って終わる', async () => {
    const result = await receiveStravaEvent(event(), { store: {}, now: NOW, env });
    expect(result.reason).toBe('no-store');
  });
});

describe('練習が届いた時', () => {
  it('取り込んでカルテへ入れる', async () => {
    const fake = store([{ userId: 'u1', profile: connected() }]);
    const push = vi.fn(async () => 'sent' as const);
    const result = await receiveStravaEvent(event(), {
      store: fake,
      now: NOW,
      env,
      fetchImpl: strava([activity(12345, '2026-10-01')]) as never,
      push: push as never,
    });

    expect(result.imported).toBe(1);
    const saved = fake.saved[0].profile;
    expect(saved.activities.map((a) => a.externalId)).toEqual(['strava:12345']);
    expect(saved.connections?.strava?.lastSyncedAt).toBe(NOW.toISOString());
  });

  it('通知の宛先があれば、その場で声をかける', async () => {
    const fake = store([{ userId: 'u1', profile: connected({ pushSubscriptions: [SUBSCRIPTION] }) }]);
    const push = vi.fn(
      async (_subscription: PushSubscriptionRecord, _payload: { title: string; body: string }) =>
        'sent' as const,
    );
    const result = await receiveStravaEvent(event(), {
      store: fake,
      now: NOW,
      env,
      fetchImpl: strava([activity(12345, '2026-10-01')]) as never,
      push: push as never,
    });

    expect(result.notified).toBe(true);
    const payload = push.mock.calls[0][1];
    expect(payload.title).toContain('20km');
    expect(payload.title).toContain('おつかれさま');
    // 同じ日の定期便と二重にならないよう、送ったことを残す。
    expect(fake.saved[0].profile.notifications?.lastTag).toBe('run-arrived');
  });

  it('宛先が無くても、取り込みは成立する', async () => {
    const fake = store([{ userId: 'u1', profile: connected() }]);
    const result = await receiveStravaEvent(event(), {
      store: fake,
      now: NOW,
      env,
      fetchImpl: strava([activity(12345, '2026-10-01')]) as never,
    });

    expect(result.imported).toBe(1);
    expect(result.notified).toBe(false);
    expect(fake.saved).toHaveLength(1);
  });

  /** 通知が落ちても、入った記録は残す。**次に開いた時には、もうある。** */
  it('通知が全部失敗しても、取り込んだ分は保存する', async () => {
    const fake = store([{ userId: 'u1', profile: connected({ pushSubscriptions: [SUBSCRIPTION] }) }]);
    const result = await receiveStravaEvent(event(), {
      store: fake,
      now: NOW,
      env,
      fetchImpl: strava([activity(12345, '2026-10-01')]) as never,
      push: vi.fn(async () => 'failed' as const) as never,
    });

    expect(result.imported).toBe(1);
    expect(result.notified).toBe(false);
    expect(fake.saved[0].profile.activities).toHaveLength(1);
    // 届いていないものを「送った」ことにしない。今日の定期便まで黙ってしまう。
    expect(fake.saved[0].profile.notifications?.lastTag).toBeUndefined();
  });

  it('つながっていないカルテには、取りに行かない', async () => {
    const profile = { ...connected(), connections: undefined };
    const fake = store([{ userId: 'u1', profile }]);
    const fetchImpl = strava([]);
    // athleteId が無いので、そもそも持ち主として見つからない。
    const result = await receiveStravaEvent(event(), { store: fake, now: NOW, env, fetchImpl: fetchImpl as never });
    expect(result.matched).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('消す方向の指示', () => {
  const withRun = () =>
    connected({
      activities: [
        {
          id: 'a1',
          date: '2026-09-30',
          type: 'run',
          distanceKm: 12,
          durationMin: 60,
          externalId: 'strava:12345',
          createdAt: '2026-09-30T10:00:00.000Z',
        },
      ],
    });

  it('購読IDが一致した時だけ、消す', async () => {
    const fake = store([{ userId: 'u1', profile: withRun() }]);
    const result = await receiveStravaEvent(event({ aspectType: 'delete' }), {
      store: fake,
      now: NOW,
      env,
      subscriberId: 99,
    });

    expect(result.removed).toBe(1);
    expect(fake.saved[0].profile.activities).toHaveLength(0);
  });

  /**
   * **Strava の通知には署名が無い。** URLを知っていれば誰でも投げられる。
   * 消す指示をそのまま通すと、他人の記録を消す道具になる。
   */
  it('購読IDが合わない指示は通さない', async () => {
    const fake = store([{ userId: 'u1', profile: withRun() }]);
    const result = await receiveStravaEvent(event({ aspectType: 'delete' }), {
      store: fake,
      now: NOW,
      env,
      subscriberId: 1,
    });

    expect(result.reason).toBe('unverified');
    expect(fake.saveProfile).not.toHaveBeenCalled();
  });

  it('購読IDが分からない時も通さない', async () => {
    const fake = store([{ userId: 'u1', profile: withRun() }]);
    const result = await receiveStravaEvent(event({ aspectType: 'delete' }), { store: fake, now: NOW, env });
    expect(result.reason).toBe('unverified');
  });

  it('持っていない練習の削除は、何も変えない', async () => {
    const fake = store([{ userId: 'u1', profile: connected() }]);
    const result = await receiveStravaEvent(event({ aspectType: 'delete', objectId: 999 }), {
      store: fake,
      now: NOW,
      env,
      subscriberId: 99,
    });

    expect(result.removed).toBe(0);
    expect(fake.saveProfile).not.toHaveBeenCalled();
  });

  /** 連携は切れても、**走った記録は本人のもの。** 消さない。 */
  it('連携を外されたら鍵だけ捨てて、記録は残す', async () => {
    const fake = store([{ userId: 'u1', profile: withRun() }]);
    const result = await receiveStravaEvent(
      {
        objectType: 'athlete',
        aspectType: 'update',
        objectId: 7,
        ownerId: 7,
        subscriberId: 99,
        updates: { authorized: 'false' },
      },
      { store: fake, now: NOW, env, subscriberId: 99 },
    );

    expect(result.disconnected).toBe(true);
    expect(fake.saved[0].profile.connections?.strava).toBeUndefined();
    expect(fake.saved[0].profile.activities).toHaveLength(1);
  });
});

describe('何もしない通知', () => {
  it('関係のない更新では、保存先に触れもしない', async () => {
    const fake = store([{ userId: 'u1', profile: connected() }]);
    const result = await receiveStravaEvent(
      { objectType: 'athlete', aspectType: 'update', objectId: 7, ownerId: 7, updates: { weight: '60' } },
      { store: fake, now: NOW, env },
    );

    expect(result.action).toBe('ignore');
    expect(fake.listProfiles).not.toHaveBeenCalled();
  });
});
