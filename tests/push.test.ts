import { describe, expect, it, vi } from 'vitest';

// vi.mock はファイルの先頭へ巻き上げられるので、参照する関数も一緒に巻き上げる。
const { sendNotification, setVapidDetails } = vi.hoisted(() => ({
  sendNotification: vi.fn(),
  setVapidDetails: vi.fn(),
}));
vi.mock('web-push', () => ({
  default: { sendNotification, setVapidDetails },
  sendNotification,
  setVapidDetails,
}));

import {
  MAX_PUSH_FAILURES,
  addSubscription,
  applyOutcomes,
  isPushConfigured,
  removeSubscription,
  sendPush,
  vapidFromEnv,
} from '@/lib/push';
import { publicProfile } from '@/lib/profile';
import { createDefaultProfile } from '@/lib/types';
import type { PushSubscriptionRecord, RunnerProfile } from '@/lib/types';

const NOW = new Date('2026-09-24T09:00:00Z');
const base = () => createDefaultProfile('u1', NOW.toISOString());
const env = {
  VAPID_PUBLIC_KEY: 'pub',
  VAPID_PRIVATE_KEY: 'priv',
  VAPID_SUBJECT: 'mailto:a@example.com',
} as unknown as NodeJS.ProcessEnv;

const target = (endpoint: string): PushSubscriptionRecord => ({
  endpoint,
  keys: { p256dh: 'p', auth: 'a' },
  createdAt: NOW.toISOString(),
});

describe('設定', () => {
  it('鍵が揃っていなければ、通知の項目を出さない', () => {
    expect(isPushConfigured({} as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(vapidFromEnv({ VAPID_PUBLIC_KEY: 'pub' } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(isPushConfigured(env)).toBe(true);
  });
});

describe('宛先', () => {
  it('端末ごとに持ち、同じ宛先は上書きする', () => {
    let profile = addSubscription(base(), { endpoint: 'https://a', keys: { p256dh: 'p', auth: 'a' } }, NOW);
    profile = addSubscription(profile, { endpoint: 'https://b', keys: { p256dh: 'p', auth: 'a' } }, NOW);
    profile = addSubscription(profile, { endpoint: 'https://a', keys: { p256dh: 'p2', auth: 'a2' } }, NOW);

    expect(profile.pushSubscriptions).toHaveLength(2);
    expect(profile.pushSubscriptions?.find((s) => s.endpoint === 'https://a')?.keys.p256dh).toBe('p2');
  });

  it('止めた端末の宛先は残さない', () => {
    const profile = removeSubscription(
      addSubscription(base(), { endpoint: 'https://a', keys: { p256dh: 'p', auth: 'a' } }, NOW),
      'https://a',
      NOW,
    );
    expect(profile.pushSubscriptions).toHaveLength(0);
  });

  it('宛先はブラウザへ返さない', () => {
    const profile = addSubscription(base(), { endpoint: 'https://canary', keys: { p256dh: 'p', auth: 'a' } }, NOW);
    expect(JSON.stringify(publicProfile(profile))).not.toContain('canary');
  });
});

describe('送信', () => {
  it('送れたら sent', async () => {
    sendNotification.mockResolvedValueOnce({});
    expect(await sendPush(target('https://a'), { title: 't', body: 'b' }, env)).toBe('sent');

    const [, payload] = sendNotification.mock.calls.at(-1)!;
    expect(JSON.parse(String(payload))).toMatchObject({ title: 't', body: 'b' });
  });

  it('宛先が消えていたら gone（消してよい合図）', async () => {
    sendNotification.mockRejectedValueOnce({ statusCode: 410 });
    expect(await sendPush(target('https://a'), { title: 't', body: 'b' }, env)).toBe('gone');
  });

  it('それ以外の失敗でも例外を投げない（1人の失敗で全体を止めない）', async () => {
    sendNotification.mockRejectedValueOnce({ statusCode: 500, message: 'boom' });
    expect(await sendPush(target('https://a'), { title: 't', body: 'b' }, env)).toBe('failed');
  });

  it('鍵が無ければ送らない', async () => {
    const before = sendNotification.mock.calls.length;
    expect(await sendPush(target('https://a'), { title: 't', body: 'b' }, {} as unknown as NodeJS.ProcessEnv)).toBe(
      'failed',
    );
    expect(sendNotification.mock.calls.length).toBe(before);
  });
});

describe('結果の反映', () => {
  const withThree = (): RunnerProfile => {
    let profile = base();
    for (const endpoint of ['https://a', 'https://b', 'https://c']) {
      profile = addSubscription(profile, { endpoint, keys: { p256dh: 'p', auth: 'a' } }, NOW);
    }
    return profile;
  };

  it('消えた宛先は落とす', () => {
    const next = applyOutcomes(withThree(), [{ endpoint: 'https://b', outcome: 'gone' }], NOW);
    expect(next.pushSubscriptions?.map((s) => s.endpoint)).toEqual(['https://a', 'https://c']);
  });

  it('失敗が続く宛先も、いずれ落とす', () => {
    let profile = withThree();
    for (let attempt = 0; attempt < MAX_PUSH_FAILURES; attempt += 1) {
      profile = applyOutcomes(profile, [{ endpoint: 'https://a', outcome: 'failed' }], NOW);
    }
    expect(profile.pushSubscriptions?.map((s) => s.endpoint)).toEqual(['https://b', 'https://c']);
  });

  it('一度でも送れたら、失敗の数を戻す', () => {
    let profile = applyOutcomes(withThree(), [{ endpoint: 'https://a', outcome: 'failed' }], NOW);
    profile = applyOutcomes(profile, [{ endpoint: 'https://a', outcome: 'sent' }], NOW);
    expect(profile.pushSubscriptions?.find((s) => s.endpoint === 'https://a')?.failures).toBe(0);
  });
});
