import { describe, expect, it } from 'vitest';
import {
  billingConfigFromEnv,
  canManageBilling,
  isBillingConfigured,
  isSubscriptionActive,
  normalizeStatus,
} from '@/lib/billing';
import { commerceInfo } from '@/lib/legal';
import { PLAN_LIMITS, planFor } from '@/lib/quota';
import { publicProfile } from '@/lib/profile';
import { createDefaultProfile, type RunnerProfile, type Subscription } from '@/lib/types';

const NOW = new Date('2026-09-29T09:00:00Z');
const envOf = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

const sub = (over: Partial<Subscription> = {}): Subscription => ({
  customerId: 'cus_123',
  subscriptionId: 'sub_123',
  status: 'active',
  updatedAt: NOW.toISOString(),
  ...over,
});

const full = {
  STRIPE_SECRET_KEY: 'sk_test_1',
  STRIPE_PRICE_ID: 'price_1',
  STRIPE_WEBHOOK_SECRET: 'whsec_1',
};

describe('設定がそろうまで、入口を出さない', () => {
  it('3つそろって、はじめて使える', () => {
    expect(isBillingConfigured(envOf(full))).toBe(true);
    expect(billingConfigFromEnv(envOf(full))).toEqual({
      secretKey: 'sk_test_1',
      priceId: 'price_1',
      webhookSecret: 'whsec_1',
    });
  });

  /** **署名の鍵が無いまま受け口を開けると、誰でも有料になれる。** */
  it('1つでも欠ければ、使えない', () => {
    for (const missing of Object.keys(full)) {
      const partial = { ...full, [missing]: '' };
      expect(isBillingConfigured(envOf(partial)), missing).toBe(false);
    }
  });

  it('貼り付けの引用符や空白は落とす', () => {
    const config = billingConfigFromEnv(envOf({ ...full, STRIPE_PRICE_ID: ' "price_1" ' }));
    expect(config?.priceId).toBe('price_1');
  });
});

describe('いつ有料として扱うか', () => {
  it('契約が無ければ、有料ではない', () => {
    expect(isSubscriptionActive(undefined, NOW)).toBe(false);
  });

  it('active と trialing は有料', () => {
    expect(isSubscriptionActive(sub({ status: 'active' }), NOW)).toBe(true);
    expect(isSubscriptionActive(sub({ status: 'trialing' }), NOW)).toBe(true);
  });

  /** 支払いが滞っている間は、枠を開けない。 */
  it('past_due と canceled は有料ではない', () => {
    expect(isSubscriptionActive(sub({ status: 'past_due' }), NOW)).toBe(false);
    expect(isSubscriptionActive(sub({ status: 'canceled' }), NOW)).toBe(false);
  });

  /**
   * **解約した人を、期間の途中で締め出さない。**
   * 解約を押した時点では status は active のまま来る。払った分は使える。
   */
  it('解約を押してあっても、期間の終わりまでは有料', () => {
    const cancelling = sub({
      cancelAtPeriodEnd: true,
      currentPeriodEnd: '2026-10-29T00:00:00Z',
    });
    expect(isSubscriptionActive(cancelling, NOW)).toBe(true);
  });

  /** 知らせが届かなかった時の保険。期限を過ぎていれば、状態を問わず無効。 */
  it('期限を過ぎていれば、active でも有料ではない', () => {
    expect(isSubscriptionActive(sub({ currentPeriodEnd: '2026-09-01T00:00:00Z' }), NOW)).toBe(false);
  });

  it('期限が分からない古い記録は、状態を信じる', () => {
    expect(isSubscriptionActive(sub({ currentPeriodEnd: undefined }), NOW)).toBe(true);
    expect(isSubscriptionActive(sub({ currentPeriodEnd: 'こわれた値' }), NOW)).toBe(true);
  });
});

describe('Stripe の状態を畳む', () => {
  it('知っている状態は、そのまま', () => {
    for (const status of ['active', 'trialing', 'past_due'] as const) {
      expect(normalizeStatus(status)).toBe(status);
    }
  });

  /** **知らない状態は、無効の側に倒す。** 分からないものを有料として扱わない。 */
  it('知らない状態は、無効として扱う', () => {
    for (const status of ['incomplete', 'unpaid', 'paused', 'なにこれ']) {
      expect(normalizeStatus(status)).toBe('canceled');
    }
  });
});

describe('枠の割り当て', () => {
  it('ログインしていない人はゲスト', () => {
    expect(planFor({ isAuthenticated: false, premium: true }, envOf({}))).toBe('guest');
  });

  it('払っていない会員は member', () => {
    expect(planFor({ isAuthenticated: true }, envOf({}))).toBe('member');
  });

  /** **お金を払っている人を、ログインの判定だけで member に落とさない。** */
  it('払っている会員は premium', () => {
    expect(planFor({ isAuthenticated: true, premium: true }, envOf({}))).toBe('premium');
  });

  it('有料の枠は、会員より広い', () => {
    expect(PLAN_LIMITS.premium.turns).toBeGreaterThan(PLAN_LIMITS.member.turns);
  });

  /** **「無制限」にはしない。** 1通の原価が決まっている以上、上限は要る。 */
  it('有料でも、上限はある', () => {
    expect(Number.isFinite(PLAN_LIMITS.premium.turns)).toBe(true);
    expect(PLAN_LIMITS.premium.turns).toBeLessThan(200);
  });
});

describe('画面へ返すもの', () => {
  const withSubscription = (): RunnerProfile => ({
    ...createDefaultProfile('u1', NOW.toISOString()),
    subscription: sub({ currentPeriodEnd: '2026-10-29T00:00:00Z', cancelAtPeriodEnd: true }),
  });

  /** 顧客IDが他人に渡れば、その人の契約を触る手がかりになる。 */
  it('顧客IDは、画面に返さない', () => {
    const shown = publicProfile(withSubscription());
    expect(shown.subscription?.customerId).toBe('');
    expect(JSON.stringify(shown)).not.toContain('cus_123');
    expect(JSON.stringify(shown)).not.toContain('sub_123');
  });

  it('状態と期限は返す（画面が「いつまで」を出せるように）', () => {
    const shown = publicProfile(withSubscription());
    expect(shown.subscription?.status).toBe('active');
    expect(shown.subscription?.currentPeriodEnd).toBe('2026-10-29T00:00:00Z');
    expect(shown.subscription?.cancelAtPeriodEnd).toBe(true);
  });

  it('契約が無ければ、何も足さない', () => {
    expect(publicProfile(createDefaultProfile('u1', NOW.toISOString())).subscription).toBeUndefined();
  });

  it('顧客IDがあれば、契約の管理を出せる', () => {
    expect(canManageBilling(withSubscription())).toBe(true);
    expect(canManageBilling(createDefaultProfile('u1', NOW.toISOString()))).toBe(false);
  });
});

describe('特定商取引法に基づく表記', () => {
  const complete = {
    LEGAL_OPERATOR_NAME: '山田太郎',
    LEGAL_ADDRESS: '東京都〇〇区〇〇 1-2-3',
    LEGAL_CONTACT_EMAIL: 'support@example.com',
    LEGAL_PRICE_TEXT: '月額 1,480円（税込）',
  };

  it('そろっていれば、完成として扱う', () => {
    expect(commerceInfo(envOf(complete)).incomplete).toBe(false);
  });

  /** **埋まるまで、お金を受け取らない。** 有料にするなら任意ではない。 */
  it('1つでも欠ければ、未完成として扱う', () => {
    for (const missing of Object.keys(complete)) {
      expect(commerceInfo(envOf({ ...complete, [missing]: '' })).incomplete, missing).toBe(true);
    }
  });

  it('責任者名を省いたら、事業者名で埋める', () => {
    expect(commerceInfo(envOf(complete)).manager).toBe('山田太郎');
    expect(commerceInfo(envOf({ ...complete, LEGAL_MANAGER_NAME: '山田花子' })).manager).toBe('山田花子');
  });

  it('未設定の欄を、空欄のまま出さない', () => {
    const info = commerceInfo(envOf({}));
    for (const value of [info.operator, info.address, info.contact, info.price]) {
      expect(value).toContain('未設定');
    }
  });
});
