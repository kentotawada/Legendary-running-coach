import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NextRequest } from 'next/server';
import PrivacyPage from '@/app/privacy/page';
import TermsPage from '@/app/terms/page';
import DisclaimerPage from '@/app/disclaimer/page';
import { POST as importWorkouts } from '@/app/api/import/route';
import { withConsent } from '@/lib/legal';
import { setStore, type CoachStore } from '@/lib/store';
import { createDefaultProfile, type CoachState } from '@/lib/types';

/**
 * 規約の文章と、コードがしていることが食い違わないように。
 *
 * **プライバシーポリシーに「送りません」と書いたことを、コードが送っていたら、それは嘘になる。**
 * 書いた約束のうち、機械で確かめられるものはここで確かめる。
 */

const text = (element: React.ReactElement) =>
  renderToStaticMarkup(element)
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"');

afterEach(() => {
  vi.unstubAllEnvs();
  setStore(null);
});

describe('プライバシーポリシー', () => {
  const page = () => text(<PrivacyPage />);

  it('体の情報を預かることと、その重さを書いている', () => {
    expect(page()).toContain('要配慮個人情報');
    expect(page()).toContain('ご本人の同意をいただいた場合にだけ');
  });

  it('返答を作るために、海外の事業者へ送ることを書いている', () => {
    for (const name of ['Google LLC', 'Supabase, Inc.', 'Vercel Inc.']) expect(page()).toContain(name);
    expect(page()).toContain('米国');
  });

  it('送らないものを、送らないと書いている', () => {
    expect(page()).toContain('走った経路（位置情報）は、送信も保存もしません');
    expect(page()).toContain('動画を送信することも、保存することもありません');
    expect(page()).toContain('IP アドレスそのものは保存しません');
  });

  it('自分で消す方法を書いている', () => {
    expect(page()).toContain('記録をすべて消去する');
  });
});

describe('書いた約束を、コードが守っている', () => {
  /**
   * 「走った経路は送信も保存もしない」の裏付け。
   * 画面は経路を送らない作りだが、**誰かが直接叩いて座標を混ぜても、保存まで届かない**ことを確かめる。
   */
  it('取り込みに座標が混ざっていても、保存しない', async () => {
    const USER = '11111111-2222-3333-4444-555555555555';
    let row: CoachState = { profile: withConsent(createDefaultProfile(USER)), history: [] };
    const store: CoachStore = {
      load: async () => row,
      save: async (_id, next) => {
        row = next;
      },
      reset: async () => undefined,
      adopt: async () => false,
    };
    setStore(store);

    const request = new Request('http://localhost/api/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workouts: [
          {
            externalId: 'file:gps',
            startedAt: '2026-09-24T21:10:00Z',
            type: 'run',
            source: 'file',
            distanceM: 5000,
            durationSec: 1500,
            // 端末が送らないはずの座標を、あえて混ぜる。
            lat: 35.681236,
            lon: 139.767125,
            samples: Array.from({ length: 20 }, (_, i) => ({
              t: i * 75,
              d: i * 250,
              hr: 150,
              lat: 35.681236 + i * 0.0001,
              lon: 139.767125,
            })),
          },
        ],
      }),
    });
    const response = await importWorkouts(
      Object.assign(request, {
        cookies: { get: (name: string) => (name === 'rc_uid' ? { name, value: USER } : undefined) },
      }) as unknown as NextRequest,
    );
    expect(response.status).toBe(200);
    expect(row.profile.activities).toHaveLength(1);

    const saved = JSON.stringify(row.profile);
    expect(saved).not.toContain('35.68');
    expect(saved).not.toContain('139.76');
    expect(saved).not.toMatch(/"(lat|lon|latitude|longitude)"/);
  });
});

describe('免責事項', () => {
  it('すぐに運動をやめる症状と、119 番を書いている', () => {
    const page = text(<DisclaimerPage />);
    for (const sign of ['胸の痛み', '息苦しさ', '動悸', 'めまい']) expect(page).toContain(sign);
    expect(page).toContain('119');
  });

  /** 安全の話が先。責任を逃れる文言から始めない。 */
  it('いちばん上に、やめる症状の一覧がある', () => {
    const page = text(<DisclaimerPage />);
    expect(page.indexOf('胸の痛み')).toBeLessThan(page.indexOf('医療ではありません'));
  });
});

describe('利用規約', () => {
  /** 消費者との契約では、責任を全部なくす条項は無効になる。書き方を崩さない。 */
  it('責任の範囲は「故意または重大な過失を除き」の形で書いている', () => {
    const page = text(<TermsPage />);
    expect(page).toContain('故意または重大な過失による場合を除き');
    expect(page).not.toContain('一切責任を負いません');
  });

  it('無料の人に、知らないうちに請求しないと書いている', () => {
    expect(text(<TermsPage />)).toContain('知らないうちに料金を請求されることはありません');
  });
});

describe('運営者の情報', () => {
  it('未設定なら、公開前に埋めるよう画面に出る', () => {
    vi.stubEnv('LEGAL_OPERATOR_NAME', '');
    vi.stubEnv('LEGAL_CONTACT_EMAIL', '');
    expect(text(<PrivacyPage />)).toContain('公開前に');
  });

  it('設定すれば、その名前と連絡先が出て、注意は消える', () => {
    vi.stubEnv('LEGAL_OPERATOR_NAME', 'RUNCOACH 運営事務局');
    vi.stubEnv('LEGAL_CONTACT_EMAIL', 'support@example.com');
    const page = text(<PrivacyPage />);
    expect(page).toContain('RUNCOACH 運営事務局');
    expect(page).toContain('support@example.com');
    expect(page).not.toContain('公開前に');
  });
});
