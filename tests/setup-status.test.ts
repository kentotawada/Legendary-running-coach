import { describe, expect, it } from 'vitest';
import { pendingSetup, setupStatus } from '@/lib/setup';

/**
 * 何が足りないかを、アプリ自身に答えさせる。
 *
 * **環境変数が増えすぎて、持ち主が把握できなくなった。**
 * 入れたつもりで入っていない、リデプロイを忘れた、名前を間違えた——
 * どれも起こるのに、起きたことに気づく手立てが無かった。
 */

const envOf = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

const labelOf = (env: NodeJS.ProcessEnv, label: string) =>
  setupStatus(env).find((status) => status.label.startsWith(label));

describe('足りないものを名指しする', () => {
  it('何も設定していなければ、全部が足りない', () => {
    const pending = pendingSetup(envOf({}));
    expect(pending.length).toBe(setupStatus(envOf({})).length);
    expect(pending.every((status) => status.missing.length > 0)).toBe(true);
  });

  it('入れたものは、足りないものから消える', () => {
    const before = labelOf(envOf({}), 'コーチとの対話');
    const after = labelOf(envOf({ GEMINI_API_KEY: 'k'.repeat(30) }), 'コーチとの対話');
    expect(before?.ready).toBe(false);
    expect(after?.ready).toBe(true);
    expect(after?.missing).toEqual([]);
  });

  /** **値は絶対に返さない。** 足りているかどうかを知るのに、中身は要らない。 */
  it('値そのものは、どこにも出さない', () => {
    const secret = 'sk_live_this_must_never_leak';
    const dump = JSON.stringify(setupStatus(envOf({ STRIPE_SECRET_KEY: secret })));
    expect(dump).not.toContain(secret);
    expect(dump).toContain('STRIPE_SECRET_KEY'.slice(0, 6));
  });

  it('貼り付け事故の空白だけの値は、入っていないものとして扱う', () => {
    expect(labelOf(envOf({ GEMINI_API_KEY: '   ' }), 'コーチとの対話')?.ready).toBe(false);
    expect(labelOf(envOf({ GEMINI_API_KEY: '""' }), 'コーチとの対話')?.ready).toBe(false);
  });

  /** 旧い名前と新しい名前が両方ある設定は、どちらか1つで足りる。 */
  it('どちらか1つでよいものは、片方あれば足りる', () => {
    const base = { NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 's' };
    const withOld = labelOf(envOf({ ...base, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a' }), '記録の保存');
    const withNew = labelOf(envOf({ ...base, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'a' }), '記録の保存');
    expect(withOld?.ready).toBe(true);
    expect(withNew?.ready).toBe(true);
  });

  it('どちらも無ければ、両方の名前を並べて知らせる', () => {
    const status = labelOf(envOf({ NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co' }), '記録の保存');
    expect(status?.missing.join(' ')).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    expect(status?.missing.join(' ')).toContain('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  });

  /** 無くても動くものと、無いと動かないものを、混ぜない。 */
  it('必須と任意を分けて示す', () => {
    const all = setupStatus(envOf({}));
    expect(all.find((s) => s.label === 'コーチとの対話')?.optional).toBe(false);
    expect(all.find((s) => s.label.startsWith('商品の紹介'))?.optional).toBe(true);
  });

  it('全部そろえば、足りないものは空になる', () => {
    const everything = envOf({
      GEMINI_API_KEY: 'k',
      NEXT_PUBLIC_SUPABASE_URL: 'u',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a',
      SUPABASE_SERVICE_ROLE_KEY: 's',
      GEMINI_PRICE_PER_MTOK: '0.5,3',
      ADMIN_EMAILS: 'me@example.com',
      NEXT_PUBLIC_SITE_URL: 'https://example.app',
      RAKUTEN_APP_ID: 'r',
      RAKUTEN_ACCESS_KEY: 'pk',
      RAKUTEN_AFFILIATE_ID: 'aff',
      STRAVA_CLIENT_ID: '1',
      STRAVA_CLIENT_SECRET: 's',
      VAPID_PRIVATE_KEY: 'v',
      VAPID_PUBLIC_KEY: 'v',
      CRON_SECRET: 'c',
      LEGAL_OPERATOR_NAME: '山田太郎',
      LEGAL_CONTACT_EMAIL: 'support@example.com',
      STRIPE_SECRET_KEY: 'sk',
      STRIPE_PRICE_ID: 'price',
      STRIPE_WEBHOOK_SECRET: 'whsec',
      LEGAL_ADDRESS: '東京都',
      LEGAL_PRICE_TEXT: '月額1,480円',
    });
    expect(pendingSetup(everything)).toEqual([]);
  });
});
