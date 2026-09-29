/**
 * Stripe との接続。**鍵はここから外へ出さない。**
 *
 * 呼び出しは全部サーバー側。ブラウザへ渡すのは、Stripe が用意した画面のURLだけ。
 */

import Stripe from 'stripe';
import type { BillingConfig } from './billing';

let client: Stripe | null = null;
let clientKey = '';

export function stripeClient(config: BillingConfig): Stripe {
  // 鍵を差し替えた時（テスト用と本番の切り替え）に、古い接続を使い回さない。
  if (!client || clientKey !== config.secretKey) {
    client = new Stripe(config.secretKey);
    clientKey = config.secretKey;
  }
  return client;
}

/** テスト用。 */
export function setStripeClient(custom: Stripe | null): void {
  client = custom;
  clientKey = custom ? 'test' : '';
}
