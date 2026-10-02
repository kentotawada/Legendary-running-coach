import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_AGE_DAYS, clearLastSeen, readLastSeen, saveLastSeen } from '@/lib/last-seen';
import { createDefaultProfile } from '@/lib/types';
import type { RunnerProfile } from '@/lib/types';

/**
 * 前回のカルテを控えておく。
 *
 * **開いた瞬間に今日やることが出る、という状態をつくるため。**
 * ここで守りたいのは2つ。
 *  1. **鍵を書かない。** 端末を共有している人には読める場所
 *  2. **古いものを使わない。** 先週の量で今日の予定を組まない
 */

const NOW = new Date('2026-10-02T08:00:00+09:00');
const DAY_MS = 86_400_000;

/** localStorage の代わり。テストは node なので window が無い。 */
function fakeStorage(options: { throwOnSet?: boolean; throwOnGet?: boolean } = {}) {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      getItem(key: string) {
        if (options.throwOnGet) throw new Error('blocked');
        return map.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        if (options.throwOnSet) throw new Error('quota');
        map.set(key, value);
      },
      removeItem(key: string) {
        map.delete(key);
      },
    },
  };
}

let current = fakeStorage();

beforeEach(() => {
  current = fakeStorage();
  (globalThis as { window?: unknown }).window = { localStorage: current.storage };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

const profileOf = (extra: Partial<RunnerProfile> = {}): RunnerProfile => ({
  ...createDefaultProfile('u1', '2026-06-01T00:00:00.000Z'),
  ...extra,
});

describe('控えて、読み直す', () => {
  it('書いたものが読める', () => {
    const profile = profileOf({ weeklyVolumeKm: 62 });
    saveLastSeen(profile, NOW);
    expect(readLastSeen(NOW)?.weeklyVolumeKm).toBe(62);
  });

  it('何も書いていなければ null', () => {
    expect(readLastSeen(NOW)).toBeNull();
  });

  it('消したら読めない', () => {
    saveLastSeen(profileOf(), NOW);
    clearLastSeen();
    expect(readLastSeen(NOW)).toBeNull();
  });
});

describe('古い控えは使わない', () => {
  it('その日のうちなら使う', () => {
    saveLastSeen(profileOf(), NOW);
    expect(readLastSeen(new Date(NOW.getTime() + 6 * 3600_000))).not.toBeNull();
  });

  it('数日前なら、まだ使う', () => {
    saveLastSeen(profileOf(), NOW);
    expect(readLastSeen(new Date(NOW.getTime() + 3 * DAY_MS))).not.toBeNull();
  });

  /** 先週の走行距離で今日の量を決めると、休んでいた週のあとに積みすぎる。 */
  it(`${MAX_AGE_DAYS}日より古ければ使わない`, () => {
    saveLastSeen(profileOf(), NOW);
    expect(readLastSeen(new Date(NOW.getTime() + (MAX_AGE_DAYS + 1) * DAY_MS))).toBeNull();
  });
});

describe('鍵を書かない', () => {
  it('Strava のトークンは控えに残らない', () => {
    const profile = profileOf({
      connections: {
        strava: {
          athleteId: 7,
          athleteName: 'Kenta S.',
          connectedAt: '2026-09-01T00:00:00.000Z',
          secret: {
            accessToken: 'ACCESS-TOKEN-XYZ',
            refreshToken: 'REFRESH-TOKEN-XYZ',
            expiresAt: 2_000_000_000,
          },
        },
      },
    });
    saveLastSeen(profile, NOW);

    const raw = current.map.get('rc.last-seen.v1') ?? '';
    expect(raw).not.toContain('ACCESS-TOKEN-XYZ');
    expect(raw).not.toContain('REFRESH-TOKEN-XYZ');
    expect(readLastSeen(NOW)?.connections?.strava?.secret).toBeUndefined();
    // つないであること自体は残す。帯の出し方が変わる。
    expect(readLastSeen(NOW)?.connections?.strava?.athleteName).toBe('Kenta S.');
  });

  it('通知の宛先は控えに残らない', () => {
    const profile = profileOf({
      pushSubscriptions: [
        { endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' }, createdAt: NOW.toISOString() },
      ],
    });
    saveLastSeen(profile, NOW);
    expect(current.map.get('rc.last-seen.v1') ?? '').not.toContain('push.example');
    expect(readLastSeen(NOW)?.pushSubscriptions).toBeUndefined();
  });

  it('契約の顧客IDは控えに残らない', () => {
    const profile = profileOf({
      subscription: {
        customerId: 'cus_secret',
        status: 'active',
        updatedAt: NOW.toISOString(),
      },
    });
    saveLastSeen(profile, NOW);
    expect(current.map.get('rc.last-seen.v1') ?? '').not.toContain('cus_secret');
    // いま有料かどうかは残す。画面がそれを使う。
    expect(readLastSeen(NOW)?.subscription?.status).toBe('active');
  });
});

describe('壊れていても落ちない', () => {
  it('中身が JSON でなければ null', () => {
    current.map.set('rc.last-seen.v1', 'not json');
    expect(readLastSeen(NOW)).toBeNull();
  });

  it('形が違えば null', () => {
    current.map.set('rc.last-seen.v1', JSON.stringify({ at: NOW.toISOString() }));
    expect(readLastSeen(NOW)).toBeNull();
  });

  it('記録の配列が無ければ null（todayPlan の中で落ちる形を通さない）', () => {
    current.map.set(
      'rc.last-seen.v1',
      JSON.stringify({ at: NOW.toISOString(), profile: { id: 'u1' } }),
    );
    expect(readLastSeen(NOW)).toBeNull();
  });

  it('時刻が読めなければ null', () => {
    current.map.set(
      'rc.last-seen.v1',
      JSON.stringify({ at: 'いつか', profile: profileOf() }),
    );
    expect(readLastSeen(NOW)).toBeNull();
  });

  /** プライベートモードでは、書くだけで例外が出る端末がある。 */
  it('書けなくても例外を投げない', () => {
    current = fakeStorage({ throwOnSet: true });
    (globalThis as { window?: unknown }).window = { localStorage: current.storage };
    expect(() => saveLastSeen(profileOf(), NOW)).not.toThrow();
  });

  it('読めなくても例外を投げない', () => {
    current = fakeStorage({ throwOnGet: true });
    (globalThis as { window?: unknown }).window = { localStorage: current.storage };
    expect(() => readLastSeen(NOW)).not.toThrow();
    expect(readLastSeen(NOW)).toBeNull();
  });

  it('window が無くても例外を投げない（サーバー側で読まれた時）', () => {
    delete (globalThis as { window?: unknown }).window;
    expect(() => saveLastSeen(profileOf(), NOW)).not.toThrow();
    expect(readLastSeen(NOW)).toBeNull();
    expect(() => clearLastSeen()).not.toThrow();
  });
});
