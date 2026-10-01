import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  actionFor,
  canSubscribe,
  challengeFor,
  currentSubscriptionId,
  ensureSubscription,
  forgetSubscriptionId,
  isDestructive,
  parseEvent,
  replaceSubscription,
  webhookVerifyToken,
} from '@/lib/strava-webhook';

/**
 * Strava から届く通知の受け取り口。
 *
 * **ここは、誰も見ていない時間に動く。** 間違えても、やり直してもらう相手がいない。
 * だから、知らない形を推測で補わないこと、消す方向の指示を安易に通さないことを、
 * テストで固定しておく。
 */

const env = { STRAVA_CLIENT_ID: '1', STRAVA_CLIENT_SECRET: 'secret-xyz' } as unknown as NodeJS.ProcessEnv;

beforeEach(() => forgetSubscriptionId());

describe('合言葉', () => {
  it('鍵が無ければ、合言葉そのものが無い', () => {
    expect(webhookVerifyToken({} as NodeJS.ProcessEnv)).toBeNull();
  });

  /** 登録する時と確かめる時で、必ず同じ値になること。環境変数を増やさないための要。 */
  it('同じ鍵からは、いつも同じ合言葉が出る', () => {
    expect(webhookVerifyToken(env)).toBe(webhookVerifyToken(env));
    expect(webhookVerifyToken(env)).toHaveLength(32);
  });

  it('鍵が違えば、合言葉も違う', () => {
    const other = { ...env, STRAVA_CLIENT_SECRET: 'another' } as unknown as NodeJS.ProcessEnv;
    expect(webhookVerifyToken(other)).not.toBe(webhookVerifyToken(env));
  });

  it('合言葉が合った時だけ、聞かれた値をそのまま返す', () => {
    const params = new URLSearchParams({
      'hub.mode': 'subscribe',
      'hub.verify_token': webhookVerifyToken(env)!,
      'hub.challenge': 'abc123',
    });
    expect(challengeFor(params, env)).toEqual({ 'hub.challenge': 'abc123' });
  });

  it('合言葉が違えば、何も返さない', () => {
    const params = new URLSearchParams({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong',
      'hub.challenge': 'abc123',
    });
    expect(challengeFor(params, env)).toBeNull();
  });

  it('subscribe 以外の問い合わせには答えない', () => {
    const params = new URLSearchParams({
      'hub.mode': 'unsubscribe',
      'hub.verify_token': webhookVerifyToken(env)!,
      'hub.challenge': 'abc123',
    });
    expect(challengeFor(params, env)).toBeNull();
  });
});

describe('届いた通知を読む', () => {
  const body = {
    object_type: 'activity',
    aspect_type: 'create',
    object_id: 12345,
    owner_id: 7,
    subscriber_id: 99,
    event_time: 1800000000,
  };

  it('練習が増えた通知を読む', () => {
    expect(parseEvent(body)).toEqual({
      objectType: 'activity',
      aspectType: 'create',
      objectId: 12345,
      ownerId: 7,
      subscriberId: 99,
      eventTime: 1800000000,
      updates: undefined,
    });
  });

  it('数字が文字列で来ても読む', () => {
    const event = parseEvent({ ...body, object_id: '12345', owner_id: '7' })!;
    expect(event.objectId).toBe(12345);
    expect(event.ownerId).toBe(7);
  });

  it('知らない形は、推測で補わずに捨てる', () => {
    expect(parseEvent(null)).toBeNull();
    expect(parseEvent('{}')).toBeNull();
    expect(parseEvent({ ...body, object_type: 'segment' })).toBeNull();
    expect(parseEvent({ ...body, aspect_type: 'merge' })).toBeNull();
    expect(parseEvent({ ...body, owner_id: undefined })).toBeNull();
    expect(parseEvent({ ...body, object_id: 'abc' })).toBeNull();
  });

  it('updates は文字列に揃える', () => {
    const event = parseEvent({ ...body, aspect_type: 'update', updates: { authorized: false } })!;
    expect(event.updates).toEqual({ authorized: 'false' });
  });
});

describe('何をするか', () => {
  const base = { objectType: 'activity', objectId: 1, ownerId: 7 } as const;

  it('新しい練習は取りに行く', () => {
    expect(actionFor({ ...base, aspectType: 'create' })).toBe('import');
  });

  it('消された練習は、こちらからも消す', () => {
    expect(actionFor({ ...base, aspectType: 'delete' })).toBe('remove');
  });

  it('名前の書き換えだけは、取り込み直す', () => {
    expect(actionFor({ ...base, aspectType: 'update', updates: { title: '閾値走' } })).toBe('import');
    expect(actionFor({ ...base, aspectType: 'update', updates: { type: 'Ride' } })).toBe('ignore');
  });

  it('連携を外された時だけ、鍵を捨てる', () => {
    const athlete = { objectType: 'athlete', objectId: 7, ownerId: 7, aspectType: 'update' } as const;
    expect(actionFor({ ...athlete, updates: { authorized: 'false' } })).toBe('disconnect');
    expect(actionFor({ ...athlete, updates: { authorized: 'true' } })).toBe('ignore');
    expect(actionFor(athlete)).toBe('ignore');
  });

  it('消す方向の指示を見分ける', () => {
    expect(isDestructive('remove')).toBe(true);
    expect(isDestructive('disconnect')).toBe(true);
    expect(isDestructive('import')).toBe(false);
  });
});

describe('登録してよい場所', () => {
  /**
   * **プレビュー用のURLで登録すると、本番の通知がそちらへ流れる。**
   * 購読はアプリにひとつしか持てないので、取り違えると全員分が止まる。
   */
  it('設定されている本番のURLと一致する時だけ登録する', () => {
    const site = { ...env, NEXT_PUBLIC_SITE_URL: 'https://runcoach.example' } as unknown as NodeJS.ProcessEnv;
    expect(canSubscribe('https://runcoach.example', site)).toBe(true);
    expect(canSubscribe('https://runcoach.example/', site)).toBe(true);
    expect(canSubscribe('https://preview-abc.vercel.app', site)).toBe(false);
  });

  it('URLが決まっていなければ、本番の実行でだけ登録する', () => {
    expect(canSubscribe('https://x.vercel.app', { ...env, VERCEL_ENV: 'production' } as never)).toBe(true);
    expect(canSubscribe('https://x.vercel.app', { ...env, VERCEL_ENV: 'preview' } as never)).toBe(false);
  });

  it('手元（http）では登録しない', () => {
    expect(canSubscribe('http://localhost:3000', { ...env, VERCEL_ENV: 'production' } as never)).toBe(false);
  });
});

/** 購読の問い合わせと登録を返す、偽の窓口。 */
function strava(options: { list?: unknown[]; created?: unknown; fail?: boolean }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (options.fail) return { ok: false, status: 500, text: async () => 'boom' } as unknown as Response;
    const method = init?.method ?? 'GET';
    if (method === 'POST') {
      return {
        ok: true,
        status: 201,
        text: async () => JSON.stringify(options.created ?? { id: 555 }),
      } as unknown as Response;
    }
    if (method === 'DELETE') {
      return { ok: true, status: 204, text: async () => '' } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(options.list ?? []),
    } as unknown as Response;
  });
}

const site = { ...env, NEXT_PUBLIC_SITE_URL: 'https://runcoach.example' } as unknown as NodeJS.ProcessEnv;
const CALLBACK = 'https://runcoach.example/api/strava/webhook';

describe('購読の登録', () => {
  it('ひとつも無ければ登録する', async () => {
    const fetchImpl = strava({ list: [] });
    expect(await ensureSubscription('https://runcoach.example', site, fetchImpl as never)).toBe('created');

    const post = fetchImpl.mock.calls.find((call) => (call[1] as RequestInit)?.method === 'POST')!;
    const body = new URLSearchParams(String((post[1] as RequestInit).body));
    expect(body.get('callback_url')).toBe(CALLBACK);
    expect(body.get('verify_token')).toBe(webhookVerifyToken(site));
  });

  it('同じURLで登録済みなら、何もしない', async () => {
    const fetchImpl = strava({ list: [{ id: 42, callback_url: CALLBACK }] });
    expect(await ensureSubscription('https://runcoach.example', site, fetchImpl as never)).toBe('exists');
    expect(fetchImpl.mock.calls.some((call) => (call[1] as RequestInit)?.method === 'POST')).toBe(false);
  });

  /** **動いているものを、自動で付け替えない。** 本番の通知を黙って奪う形になる。 */
  it('別のURLで登録済みなら、手を触れずに知らせる', async () => {
    const fetchImpl = strava({ list: [{ id: 42, callback_url: 'https://old.example/api/strava/webhook' }] });
    expect(await ensureSubscription('https://runcoach.example', site, fetchImpl as never)).toBe('mismatch');
    const touched = fetchImpl.mock.calls.map((call) => (call[1] as RequestInit)?.method ?? 'GET');
    expect(touched).toEqual(['GET']);
  });

  it('登録してよい場所でなければ、問い合わせもしない', async () => {
    const fetchImpl = strava({ list: [] });
    expect(await ensureSubscription('http://localhost:3000', site, fetchImpl as never)).toBe('skipped');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('Strava 側で失敗しても、例外にしない', async () => {
    const fetchImpl = strava({ fail: true });
    expect(await ensureSubscription('https://runcoach.example', site, fetchImpl as never)).toBe('failed');
  });

  it('付け替えは、古いものを消してから登録する', async () => {
    const fetchImpl = strava({ list: [{ id: 42, callback_url: 'https://old.example/api/strava/webhook' }] });
    expect(await replaceSubscription('https://runcoach.example', site, fetchImpl as never)).toBe('created');
    const methods = fetchImpl.mock.calls.map((call) => (call[1] as RequestInit)?.method ?? 'GET');
    expect(methods).toEqual(['GET', 'DELETE', 'POST']);
  });
});

describe('いまの購読ID', () => {
  it('一度問い合わせたら、しばらく覚えている', async () => {
    const fetchImpl = strava({ list: [{ id: 42, callback_url: CALLBACK }] });
    const now = new Date('2026-10-01T00:00:00Z');
    expect(await currentSubscriptionId(site, fetchImpl as never, now)).toBe(42);
    expect(await currentSubscriptionId(site, fetchImpl as never, now)).toBe(42);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  /** **取れないことを、消してよい理由にしない。** 分からない時は undefined のまま。 */
  it('問い合わせに失敗したら、分からないままにする', async () => {
    const fetchImpl = strava({ fail: true });
    expect(await currentSubscriptionId(site, fetchImpl as never)).toBeUndefined();
  });
});
