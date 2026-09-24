import { describe, expect, it, vi } from 'vitest';
import {
  STRAVA_SCOPE,
  StravaError,
  activityTypeOf,
  authorizeUrl,
  cadenceToSpm,
  exchangeCode,
  fetchActivities,
  isDefaultName,
  isStravaConfigured,
  needsRefresh,
  refreshTokens,
  shoeRoleOf,
  stravaRedirectUri,
  toActivityLog,
} from '@/lib/strava';
import { stateMatches } from '@/lib/strava-state';

const env = {
  STRAVA_CLIENT_ID: '12345',
  STRAVA_CLIENT_SECRET: 'secret',
} as unknown as NodeJS.ProcessEnv;

function ok(json: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(json),
  } as unknown as Response);
}

function fails(status: number, body = '{}') {
  return vi.fn().mockResolvedValue({ ok: false, status, text: async () => body } as unknown as Response);
}

describe('設定', () => {
  it('鍵が揃っていなければ、連携そのものを出さない', () => {
    expect(isStravaConfigured({} as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isStravaConfigured({ STRAVA_CLIENT_ID: 'a' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isStravaConfigured(env)).toBe(true);
  });

  it('戻り先はアプリ自身の URL', () => {
    expect(stravaRedirectUri('https://example.com/')).toBe('https://example.com/api/strava/callback');
  });

  it('認可URLには、非公開の練習まで読む権限と state が載る', () => {
    const url = new URL(authorizeUrl('https://example.com', 'tok123', env));
    expect(url.searchParams.get('client_id')).toBe('12345');
    expect(url.searchParams.get('scope')).toBe(STRAVA_SCOPE);
    expect(url.searchParams.get('state')).toBe('tok123');
    expect(url.searchParams.get('redirect_uri')).toBe('https://example.com/api/strava/callback');
  });

  it('state が食い違えば、つながない', () => {
    expect(stateMatches('abc', 'abc')).toBe(true);
    expect(stateMatches('abc', 'xyz')).toBe(false);
    expect(stateMatches(undefined, 'abc')).toBe(false);
    expect(stateMatches('abc', null)).toBe(false);
  });
});

describe('鍵のやり取り', () => {
  it('認可コードを鍵に替える', async () => {
    const fetchImpl = ok({
      access_token: 'at',
      refresh_token: 'rt',
      expires_at: 1800000000,
      athlete: { id: 7, firstname: '健太', lastname: '田中' },
    });
    const tokens = await exchangeCode('code-1', env, fetchImpl);

    expect(tokens).toMatchObject({ accessToken: 'at', refreshToken: 'rt', athleteId: 7 });
    expect(tokens.athleteName).toBe('健太 田中');
  });

  it('期限が近ければ更新する', () => {
    const now = new Date('2026-09-24T09:00:00Z');
    const epoch = Math.floor(now.getTime() / 1000);
    expect(needsRefresh(epoch + 30, now)).toBe(true);
    expect(needsRefresh(epoch + 3600, now)).toBe(false);
  });

  it('更新後の鍵を返す', async () => {
    const tokens = await refreshTokens('old', env, ok({ access_token: 'new', refresh_token: 'new-r', expires_at: 1 }));
    expect(tokens.accessToken).toBe('new');
  });

  it('鍵が返ってこなければ、その場で止める', async () => {
    await expect(exchangeCode('bad', env, ok({ message: 'Bad Request' }))).rejects.toBeInstanceOf(StravaError);
  });

  it('401 と 429 は、言い方を変える', async () => {
    await expect(exchangeCode('x', env, fails(401))).rejects.toMatchObject({
      message: expect.stringContaining('接続が切れています'),
      status: 401,
    });
    await expect(exchangeCode('x', env, fails(429))).rejects.toMatchObject({
      message: expect.stringContaining('利用上限'),
      status: 429,
    });
  });
});

describe('種目の読み替え', () => {
  it('走った記録として扱うもの', () => {
    expect(activityTypeOf({ id: 1, sport_type: 'Run' })).toBe('run');
    expect(activityTypeOf({ id: 1, sport_type: 'TrailRun' })).toBe('run');
    expect(activityTypeOf({ id: 1, type: 'VirtualRun' })).toBe('run');
  });

  it('走っていないものは、それぞれの区分へ', () => {
    expect(activityTypeOf({ id: 1, sport_type: 'Walk' })).toBe('walk');
    expect(activityTypeOf({ id: 1, sport_type: 'Ride' })).toBe('cross');
    expect(activityTypeOf({ id: 1, sport_type: 'Swim' })).toBe('cross');
    expect(activityTypeOf({ id: 1, sport_type: 'WeightTraining' })).toBe('strength');
    expect(activityTypeOf({ id: 1, sport_type: 'Yoga' })).toBe('stretch');
  });

  it('知らない種目は取り込まない', () => {
    expect(activityTypeOf({ id: 1, sport_type: 'Kitesurf' })).toBeNull();
  });
});

describe('自動でついた名前', () => {
  it('Strava が付けた既定の名前は、練習の種別として使わない', () => {
    expect(isDefaultName('Morning Run')).toBe(true);
    expect(isDefaultName('午後のランニング')).toBe(true);
    expect(isDefaultName('  ')).toBe(true);
  });

  it('本人が書き換えた名前は、そのまま意味を持つ', () => {
    expect(isDefaultName('閾値走 20分')).toBe(false);
  });
});

describe('ピッチ', () => {
  it('片脚の回転数を、1分あたりの歩数に直す', () => {
    expect(cadenceToSpm(85.5)).toBe(171);
    expect(cadenceToSpm(0)).toBeUndefined();
    expect(cadenceToSpm(undefined)).toBeUndefined();
  });
});

describe('1件の読み替え', () => {
  const activity = {
    id: 998,
    name: '閾値走 20分',
    sport_type: 'Run',
    start_date_local: '2026-09-22T06:30:00Z',
    distance: 12000,
    moving_time: 3060, // 51分 → 4:15/km
    average_heartrate: 158.4,
    max_heartrate: 176.2,
    average_cadence: 88,
    total_elevation_gain: 42.7,
  };

  it('距離・時間・ペース・心拍・ピッチをそのまま記録にする', () => {
    const log = toActivityLog(activity)!;

    expect(log).toMatchObject({
      date: '2026-09-22',
      type: 'run',
      session: '閾値走 20分',
      distanceKm: 12,
      durationMin: 51,
      source: 'strava',
      externalId: 'strava:998',
    });
    expect(log.metrics).toMatchObject({
      avgPace: '4:15/km',
      avgHr: 158,
      maxHr: 176,
      cadence: 176,
      elevationGainM: 43,
    });
  });

  it('ストライドはピッチと速度から出す', () => {
    // 12000m / 51分 = 235.3m/分。÷176spm ≒ 1.34m
    expect(toActivityLog(activity)!.metrics?.strideM).toBeCloseTo(1.34, 2);
  });

  it('日付は現地時刻のまま切り出す（時差で1日ずれない）', () => {
    const late = toActivityLog({ ...activity, start_date_local: '2026-09-22T23:30:00Z' })!;
    expect(late.date).toBe('2026-09-22');
  });

  it('既定の名前なら、練習の種別を空にする', () => {
    expect(toActivityLog({ ...activity, name: 'Morning Run' })!.session).toBeUndefined();
  });

  it('距離も時間も無い記録は捨てる', () => {
    expect(toActivityLog({ id: 1, sport_type: 'Run', start_date_local: '2026-09-22T06:30:00Z' })).toBeNull();
  });

  it('日付が読めない記録も捨てる', () => {
    expect(toActivityLog({ id: 1, sport_type: 'Run', distance: 5000, moving_time: 1500 })).toBeNull();
  });

  it('自転車ではピッチを2倍にしない（あれはケイデンス）', () => {
    const ride = toActivityLog({
      id: 2,
      sport_type: 'Ride',
      start_date_local: '2026-09-22T06:30:00Z',
      distance: 30000,
      moving_time: 3600,
      average_cadence: 85,
    })!;
    expect(ride.type).toBe('cross');
    expect(ride.metrics?.cadence).toBeUndefined();
  });
});

describe('練習の取得', () => {
  it('ページをまたいで集め、古い順に並べる', async () => {
    const page1 = Array.from({ length: 50 }, (_, index) => ({
      id: index + 1,
      start_date_local: `2026-09-${String((index % 28) + 1).padStart(2, '0')}T06:00:00Z`,
    }));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify(page1) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify([{ id: 999, start_date_local: '2026-08-01T06:00:00Z' }]),
      });

    const activities = await fetchActivities('at', 1700000000, fetchImpl as unknown as typeof fetch);

    expect(activities).toHaveLength(51);
    expect(activities[0].id).toBe(999); // いちばん古いもの
    expect(String(fetchImpl.mock.calls[0][0])).toContain('after=1700000000');
  });

  it('1ページで終われば、それ以上叩かない', async () => {
    const fetchImpl = ok([{ id: 1, start_date_local: '2026-09-01T06:00:00Z' }]);
    await fetchActivities('at', 0, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('靴の用途', () => {
  it('レース用と分かる名前は、寿命の短い方で見る', () => {
    expect(shoeRoleOf('Nike Alphafly 3')).toBe('race');
    expect(shoeRoleOf('Metaspeed Sky')).toBe('race');
    expect(shoeRoleOf('ゲルカヤノ 31')).toBe('daily');
  });
});
