/**
 * find_gear の実装。
 *
 * ほかのツールと違って、これは外の世界（モールの商品検索）を叩くので非同期です。
 * 失敗しても対話は続けます。候補が取れなかった時は、
 * 「候補は無い。検索リンクで出せ」とモデルに伝えるところまでが仕事です。
 */

import type { RunnerProfile } from './types';
import { GEAR_CATEGORIES } from './gear';
import { gearQueryFor, gearSpecFor } from './gear-spec';
import { DEFAULT_CANDIDATE_LIMIT, isCatalogConfigured, searchCatalog } from './catalog';
import { addToBasket, type ProductBasket } from './products';

export const FIND_GEAR = 'find_gear';

export interface FindGearOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  limit?: number;
}

/** 商品が安すぎる時は、たいてい付属品か偽物。カテゴリごとの下限を置く。 */
const MIN_PRICE: Record<string, number> = {
  'shoes-daily': 5_000,
  'shoes-race': 8_000,
  watch: 8_000,
  hrm: 3_000,
  gels: 1_000,
  scale: 2_000,
  socks: 800,
  care: 1_000,
};

export async function runFindGear(
  profile: RunnerProfile,
  rawArgs: unknown,
  basket: ProductBasket,
  now: Date = new Date(),
  options: FindGearOptions = {},
): Promise<Record<string, unknown>> {
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>;
  const category = typeof args.category === 'string' ? args.category.trim() : '';
  const keywords = typeof args.keywords === 'string' ? args.keywords.trim() : '';

  const known = GEAR_CATEGORIES.find((entry) => entry.id === category);
  if (!known) {
    return {
      ok: false,
      error: `未知のカテゴリ: ${category || '（空）'}`,
      usable: GEAR_CATEGORIES.map((entry) => entry.id),
    };
  }

  const spec = gearSpecFor(category, profile, now);
  const shared = {
    category,
    title: known.title,
    requirements: spec?.requirements ?? [],
    quantity: spec?.quantity,
    timing: spec?.timing,
    skipIf: spec?.skipIf,
  };

  if (!isCatalogConfigured(options.env ?? process.env)) {
    return {
      ...shared,
      ok: true,
      candidates: [],
      note:
        'このアプリでは商品一覧を取得できない設定になっている。product ブロックは使わず、' +
        'gear ブロックで検索リンクだけを出し、上の条件は自分の言葉で伝えること。',
    };
  }

  const query = gearQueryFor(category, profile, keywords, now);
  const found = await searchCatalog(query, {
    limit: options.limit ?? DEFAULT_CANDIDATE_LIMIT,
    minPrice: MIN_PRICE[category],
    env: options.env,
    fetchImpl: options.fetchImpl,
  });

  if (found.length === 0) {
    return {
      ...shared,
      ok: true,
      query,
      candidates: [],
      note:
        '候補が取れなかった。product ブロックは使わず、gear ブロックで検索リンクを出すこと。' +
        '**候補が無いまま商品名を書いてはならない。**',
    };
  }

  const added = addToBasket(basket, found, spec);

  return {
    ...shared,
    ok: true,
    query,
    // URLと画像はモデルに渡さない。渡さなければ、書き写して間違える余地も無い。
    candidates: added.map((candidate) => ({
      ref: candidate.ref,
      name: candidate.name,
      price: candidate.price,
      shop: candidate.shop,
      review:
        candidate.reviewCount && candidate.reviewCount > 0
          ? `★${candidate.reviewAverage?.toFixed(1) ?? '-'}（${candidate.reviewCount}件）`
          : 'レビューなし',
    })),
    note:
      'この候補の中から選び、product ブロックで名札（ref）だけを指すこと。' +
      '名前・価格・リンクはアプリが埋める。why には、この人のどの事情に効くのかを書く。',
  };
}
