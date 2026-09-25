import { describe, expect, it, vi } from 'vitest';
import { connectionDoctrine, describeSync, syncStrava } from '@/lib/sync';
import { StravaError } from '@/lib/strava';
import { addShoeDistance, addShoes, applyProfileUpdate, publicProfile } from '@/lib/profile';
import { activeShoes } from '@/lib/shoes';
import { createDefaultProfile } from '@/lib/types';
import type { RunnerProfile } from '@/lib/types';

const NOW = new Date('2026-09-24T09:00:00Z');
const env = { STRAVA_CLIENT_ID: '1', STRAVA_CLIENT_SECRET: 's' } as unknown as NodeJS.ProcessEnv;

function connected(
  profile: RunnerProfile = createDefaultProfile('u1', NOW.toISOString()),
  overrides: Partial<{ expiresAt: number; lastSyncedAt: string; imported: number }> = {},
): RunnerProfile {
  return {
    ...profile,
    connections: {
      strava: {
        athleteId: 7,
        athleteName: '健太',
        connectedAt: '2026-09-01T00:00:00.000Z',
        lastSyncedAt: overrides.lastSyncedAt,
        imported: overrides.imported ?? 0,
        secret: {
          accessToken: 'access-token-xyz',
          refreshToken: 'refresh-token-xyz',
          // 既定では十分に先の期限。更新を走らせない。
          expiresAt: overrides.expiresAt ?? Math.floor(NOW.getTime() / 1000) + 7200,
        },
      },
    },
  };
}

const run = (id: number, date: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: 'Morning Run',
  sport_type: 'Run',
  start_date_local: `${date}T06:00:00Z`,
  distance: 10000,
  moving_time: 3000,
  ...extra,
});

/** URL ごとに返すものを変える偽の窓口。 */
function mall(options: {
  activities?: unknown[][];
  gear?: Record<string, unknown>;
  token?: Record<string, unknown>;
}) {
  const pages = options.activities ?? [[]];
  let page = 0;
  return vi.fn(async (url: string) => {
    const href = String(url);
    if (href.includes('/oauth/token')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify(
            options.token ?? { access_token: 'at2', refresh_token: 'rt2', expires_at: 1900000000 },
          ),
      } as unknown as Response;
    }
    if (href.includes('/gear/')) {
      const id = href.split('/gear/')[1];
      const gear = options.gear?.[decodeURIComponent(id)];
      return {
        ok: Boolean(gear),
        status: gear ? 200 : 404,
        text: async () => JSON.stringify(gear ?? {}),
      } as unknown as Response;
    }
    const body = pages[Math.min(page, pages.length - 1)] ?? [];
    page += 1;
    return { ok: true, status: 200, text: async () => JSON.stringify(body) } as unknown as Response;
  });
}

describe('取り込み', () => {
  it('つながっていなければ、その場で言う', async () => {
    await expect(
      syncStrava(createDefaultProfile('u1', NOW.toISOString()), { now: NOW, env }),
    ).rejects.toBeInstanceOf(StravaError);
  });

  it('練習をカルテへ入れる', async () => {
    const fetchImpl = mall({ activities: [[run(1, '2026-09-22'), run(2, '2026-09-23')]] });
    const result = await syncStrava(connected(), { now: NOW, env, fetchImpl: fetchImpl as never });

    expect(result.imported).toBe(2);
    expect(result.firstTime).toBe(true);
    expect(result.profile.activities.map((a) => a.externalId)).toEqual(['strava:1', 'strava:2']);
    expect(result.profile.activities[0]).toMatchObject({ type: 'run', distanceKm: 10, source: 'strava' });
    expect(result.profile.connections?.strava?.lastSyncedAt).toBe(NOW.toISOString());
    expect(result.profile.connections?.strava?.imported).toBe(2);
  });

  it('初回は90日分まで遡り、2回目からは前回の続きだけ', async () => {
    const first = mall({ activities: [[run(1, '2026-09-22')]] });
    await syncStrava(connected(), { now: NOW, env, fetchImpl: first as never });
    const firstAfter = Number(new URL(String(first.mock.calls[0][0])).searchParams.get('after'));
    expect(Math.floor(NOW.getTime() / 1000) - firstAfter).toBe(90 * 86400);

    const second = mall({ activities: [[]] });
    await syncStrava(connected(undefined, { lastSyncedAt: '2026-09-23T09:00:00.000Z' }), {
      now: NOW,
      env,
      fetchImpl: second as never,
    });
    const secondAfter = Number(new URL(String(second.mock.calls[0][0])).searchParams.get('after'));
    // 1時間だけ重ねて取りに行く（境目の1本を落とさないため）
    expect(secondAfter).toBe(Math.floor(Date.parse('2026-09-23T09:00:00.000Z') / 1000) - 3600);
  });

  /**
   * 出どころが分かれば、連携画面はその道具の手順を畳める。
   * 済んだ手順を見せ続けるのは、「まだ終わっていない」と言っているのと同じ。
   */
  it('どの時計から届いたかを覚える', async () => {
    const fetchImpl = mall({
      activities: [[run(1, '2026-09-22', { external_id: 'garmin_push_998877' })]],
    });
    const result = await syncStrava(connected(), { now: NOW, env, fetchImpl: fetchImpl as never });

    expect(result.sources).toEqual(['garmin']);
    expect(result.garminDetected).toBe(true);
    expect(result.profile.connections?.strava?.sources).toEqual(['garmin']);
    // 出どころは鍵ではないので、画面まで運ぶ。
    expect(publicProfile(result.profile).connections?.strava?.sources).toEqual(['garmin']);
  });

  it('今回の取り込みに出てこなくても、一度分かった出どころは消さない', async () => {
    const first = await syncStrava(connected(), {
      now: NOW,
      env,
      fetchImpl: mall({
        activities: [[run(1, '2026-09-22', { external_id: 'garmin_push_1' })]],
      }) as never,
    });

    const second = await syncStrava(first.profile, {
      now: NOW,
      env,
      fetchImpl: mall({ activities: [[run(2, '2026-09-23')]] }) as never,
    });

    expect(second.profile.connections?.strava?.sources).toEqual(['garmin']);
  });

  it('同じ練習は二度入らない', async () => {
    const fetchImpl = mall({ activities: [[run(1, '2026-09-22')]] });
    const once = await syncStrava(connected(), { now: NOW, env, fetchImpl: fetchImpl as never });

    const again = await syncStrava(once.profile, {
      now: NOW,
      env,
      fetchImpl: mall({ activities: [[run(1, '2026-09-22')]] }) as never,
    });

    expect(again.imported).toBe(0);
    expect(again.skipped).toBe(1);
    expect(again.profile.activities).toHaveLength(1);
  });

  it('期限が切れていれば鍵を更新し、新しい鍵を保存する', async () => {
    const fetchImpl = mall({
      activities: [[]],
      token: { access_token: 'fresh', refresh_token: 'fresh-r', expires_at: 1900000000 },
    });
    const result = await syncStrava(connected(undefined, { expiresAt: 1 }), {
      now: NOW,
      env,
      fetchImpl: fetchImpl as never,
    });

    expect(result.profile.connections?.strava?.secret).toMatchObject({
      accessToken: 'fresh',
      refreshToken: 'fresh-r',
    });
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/oauth/token');
  });
});

describe('シューズ', () => {
  it('Strava の靴を取り込み、走行距離は向こうの値をそのまま使う', async () => {
    const fetchImpl = mall({
      activities: [[run(1, '2026-09-22', { gear_id: 'g9' })]],
      gear: { g9: { id: 'g9', name: 'Alphafly 3', distance: 412_300 } },
    });
    const result = await syncStrava(connected(), { now: NOW, env, fetchImpl: fetchImpl as never });

    const shoe = activeShoes(result.profile)[0];
    expect(shoe).toMatchObject({ name: 'Alphafly 3', km: 412, role: 'race', externalId: 'strava:g9' });
    expect(result.shoes).toBe(1);
    // どの靴で走ったかも残る
    expect(result.profile.activities[0].shoeId).toBe(shoe.id);
  });

  it('二度目の取り込みでも、距離は足されず上書きされる', async () => {
    const first = await syncStrava(connected(), {
      now: NOW,
      env,
      fetchImpl: mall({
        activities: [[run(1, '2026-09-22', { gear_id: 'g9' })]],
        gear: { g9: { id: 'g9', name: 'Kayano 31', distance: 400_000 } },
      }) as never,
    });

    const second = await syncStrava(first.profile, {
      now: NOW,
      env,
      fetchImpl: mall({
        activities: [[run(2, '2026-09-23', { gear_id: 'g9' })]],
        gear: { g9: { id: 'g9', name: 'Kayano 31', distance: 410_000 } },
      }) as never,
    });

    expect(activeShoes(second.profile)).toHaveLength(1);
    expect(activeShoes(second.profile)[0].km).toBe(410);
  });

  it('外部が管理している靴には、こちらから足さない', () => {
    const profile = connected();
    const withShoe = {
      ...profile,
      shoes: [
        { id: 's1', name: 'Kayano', role: 'daily' as const, km: 400, externalId: 'strava:g9', updatedAt: '' },
      ],
    };
    expect(addShoeDistance(withShoe, 's1', 10, NOW).shoes?.[0].km).toBe(400);
  });

  it('Strava で靴を管理していない人には、こちらの1足へ積む', async () => {
    const profile = addShoes(connected(), { name: 'ゲルカヤノ31', km: 300 }, NOW);
    const result = await syncStrava(profile, {
      now: NOW,
      env,
      fetchImpl: mall({ activities: [[run(1, '2026-09-22')]] }) as never,
    });
    expect(activeShoes(result.profile)[0].km).toBe(310);
  });

  it('2足あってどれか分からなければ、積まない', async () => {
    let profile = addShoes(connected(), { name: 'A', km: 300 }, NOW);
    profile = addShoes(profile, { name: 'B', km: 100 }, NOW);
    const result = await syncStrava(profile, {
      now: NOW,
      env,
      fetchImpl: mall({ activities: [[run(1, '2026-09-22')]] }) as never,
    });
    expect(activeShoes(result.profile).map((shoe) => shoe.km).sort((a, b) => a - b)).toEqual([100, 300]);
  });

  it('靴の情報が取れなくても、練習の取り込みは止めない', async () => {
    const result = await syncStrava(connected(), {
      now: NOW,
      env,
      fetchImpl: mall({ activities: [[run(1, '2026-09-22', { gear_id: 'missing' })]], gear: {} }) as never,
    });
    expect(result.imported).toBe(1);
    expect(result.shoes).toBe(0);
  });
});

describe('Garminからの自動連携', () => {
  it('取り込んだ記録の出どころが Garmin なら、確認できたと返す', async () => {
    const result = await syncStrava(connected(), {
      now: NOW,
      env,
      fetchImpl: mall({
        activities: [[run(1, '2026-09-22', { external_id: 'garmin_push_9876543210' })]],
      }) as never,
    });
    expect(result.garminDetected).toBe(true);
  });

  it('出どころが分からない時は、断定しない', async () => {
    const result = await syncStrava(connected(), {
      now: NOW,
      env,
      fetchImpl: mall({ activities: [[run(1, '2026-09-22')]] }) as never,
    });
    // 「確認できなかった」であって「つながっていない」ではない
    expect(result.garminDetected).toBe(false);
    expect(result.imported).toBe(1);
  });
});

describe('鍵の扱い', () => {
  it('画面へ返すカルテには、鍵が入らない', () => {
    const shown = publicProfile(connected());
    expect(shown.connections?.strava?.secret).toBeUndefined();
    expect(JSON.stringify(shown)).not.toContain('refresh-token-xyz');
    expect(JSON.stringify(shown)).not.toContain('access-token-xyz');
    // 画面に出したい情報は残る
    expect(shown.connections?.strava?.athleteName).toBe('健太');
  });

  it('接続が無いカルテは、そのまま返す', () => {
    const plain = applyProfileUpdate(createDefaultProfile('u1'), { displayName: 'ケント' }, NOW);
    expect(publicProfile(plain)).toBe(plain);
  });
});

describe('取り込みの知らせ方', () => {
  it('新しい練習が無ければ、そう言う', () => {
    expect(
      describeSync({
        profile: connected(),
        imported: 0,
        skipped: 3,
        shoes: 0,
        firstTime: false,
        garminDetected: false,
        sources: [],
      }),
    ).toContain('新しい練習はありません');
  });

  it('取り込んだ数と、更新した靴の数を言う', () => {
    const text = describeSync({
      profile: connected(),
      imported: 4,
      skipped: 1,
      shoes: 2,
      firstTime: true,
      garminDetected: true,
      sources: ['garmin'],
    });
    expect(text).toContain('4件');
    expect(text).toContain('シューズ2足');
    // どこから流れてきたかを名前で返す。設定が正しかったと、その場で分かる。
    expect(text).toContain('Garmin の時計からの自動連携');
  });
});

describe('コーチへの伝え方', () => {
  it('つながっていれば、スクリーンショットを求めさせない', () => {
    const text = connectionDoctrine(connected(), true, NOW)!;
    expect(text).toContain('求めないこと');
    expect(text).toContain('主観');
  });

  it('つながっていなくても、1回や2回なら案内しない', () => {
    const profile = createDefaultProfile('u1', NOW.toISOString());
    expect(connectionDoctrine(profile, true, NOW)).toBeNull();
  });

  it('何度も撮らせているなら、一度だけ案内させる', () => {
    let profile = createDefaultProfile('u1', NOW.toISOString());
    for (const id of [1, 2, 3]) {
      profile = {
        ...profile,
        activities: [
          ...profile.activities,
          {
            id: `a${id}`,
            date: '2026-09-20',
            type: 'run' as const,
            source: 'screenshot' as const,
            createdAt: '2026-09-20T09:00:00.000Z',
          },
        ],
      };
    }
    const text = connectionDoctrine(profile, true, NOW)!;
    expect(text).toContain('3回');
    expect(text).toContain('案内は一度だけ');
    // 手順そのものを会話で喋らせない（画面に用意してある）
    expect(text).toContain('手順を会話で長々と説明しない');
  });

  it('アプリ側で連携が使えない設定なら、何も言わせない', () => {
    const profile = createDefaultProfile('u1', NOW.toISOString());
    expect(connectionDoctrine(profile, false, NOW)).toBeNull();
  });
});
