import { afterEach, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { PATCH } from '@/app/api/profile/route';
import { CONSENT_VERSION, hasConsent, operatorInfo, withConsent } from '@/lib/legal';
import { setStore, type CoachStore } from '@/lib/store';
import { createDefaultProfile, type CoachState } from '@/lib/types';

/**
 * 規約への同意。
 *
 * **体の情報を預かるのは、同意した人からだけ。** そして「どの版に・いつ」を残す。
 * 後から規約を変えた時に、誰がどの版に同意しているかが分からないと、同意を取った意味が無くなる。
 */

const USER = '11111111-2222-3333-4444-555555555555';
const envOf = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

describe('同意しているか', () => {
  it('いまの版に同意していれば、同意済み', () => {
    expect(hasConsent(withConsent(createDefaultProfile(USER)))).toBe(true);
  });

  it('同意したことが無ければ、未同意', () => {
    expect(hasConsent(createDefaultProfile(USER))).toBe(false);
    expect(hasConsent(null)).toBe(false);
  });

  /** 規約を変えて版を上げたら、全員にもう一度聞く。 */
  it('古い版への同意は、同意とみなさない', () => {
    const old = { ...createDefaultProfile(USER), consent: { version: '2020-01-01', at: '2020-01-01T00:00:00Z' } };
    expect(hasConsent(old)).toBe(false);
  });
});

describe('同意を記録する', () => {
  function memoryStore() {
    let row: CoachState = { profile: createDefaultProfile(USER), history: [] };
    const store: CoachStore = {
      load: async () => row,
      save: async (_userId, next) => {
        row = next;
      },
      reset: async () => undefined,
      adopt: async () => false,
    };
    return { store, read: () => row };
  }

  function patch(body: unknown): NextRequest {
    const request = new Request('http://localhost/api/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return Object.assign(request, {
      cookies: { get: (name: string) => (name === 'rc_uid' ? { name, value: USER } : undefined) },
    }) as unknown as NextRequest;
  }

  afterEach(() => setStore(null));

  it('同意したら、いまの版と時刻がサーバーで記録される', async () => {
    const memory = memoryStore();
    setStore(memory.store);
    const before = Date.now();
    const response = await PATCH(patch({ consent: true }));
    expect(response.status).toBe(200);
    const consent = memory.read().profile.consent;
    expect(consent?.version).toBe(CONSENT_VERSION);
    expect(Date.parse(consent!.at)).toBeGreaterThanOrEqual(before - 1000);
  });

  /** **画面から版や日付を受け取らない。** 受け取ると、同意していない版に同意したことにできる。 */
  it('画面から送られた版や日付は、受け付けない', async () => {
    const memory = memoryStore();
    setStore(memory.store);
    await PATCH(patch({ consent: { version: '2099-01-01', at: '2000-01-01T00:00:00Z' } }));
    expect(memory.read().profile.consent).toBeUndefined();
  });

  it('同意は、画面に返すカルテにも載る（同意の画面を閉じるため）', async () => {
    const memory = memoryStore();
    setStore(memory.store);
    const response = await PATCH(patch({ consent: true }));
    const data = (await response.json()) as { profile: { consent?: { version: string } } };
    expect(data.profile.consent?.version).toBe(CONSENT_VERSION);
  });
});

describe('運営者の情報', () => {
  it('設定されていなければ、未設定と分かる形で出す', () => {
    const info = operatorInfo(envOf({}));
    expect(info.incomplete).toBe(true);
    expect(info.name).toContain('未設定');
  });

  it('設定されていれば、それを出す', () => {
    const info = operatorInfo(envOf({ LEGAL_OPERATOR_NAME: 'RUNCOACH 運営事務局', LEGAL_CONTACT_EMAIL: 'support@example.com' }));
    expect(info.incomplete).toBe(false);
    expect(info.name).toBe('RUNCOACH 運営事務局');
    expect(info.contact).toBe('support@example.com');
  });
});
