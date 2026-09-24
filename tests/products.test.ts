import { describe, expect, it, vi } from 'vitest';
import { addToBasket, emptyBasket, productDoctrine, resolveProductBlocks } from '@/lib/products';
import { runFindGear } from '@/lib/gear-tool';
import type { ProductCandidate } from '@/lib/catalog';
import { gearSpecFor } from '@/lib/gear-spec';
import { createDefaultProfile } from '@/lib/types';
import { applyProfileUpdate } from '@/lib/profile';
import { parseRichText } from '@/lib/richtext';

const NOW = new Date('2026-09-24T09:00:00Z');
const base = () => createDefaultProfile('u1', NOW.toISOString());

function candidate(overrides: Partial<ProductCandidate> = {}): ProductCandidate {
  return {
    ref: 'p1',
    id: 'shop:1',
    name: 'ジェル 30個セット',
    price: 5_400,
    shop: 'スポーツ店',
    url: 'https://hb.afl.rakuten.co.jp/hgc/xxxx/',
    imageUrl: 'https://thumbnail.image.rakuten.co.jp/a.jpg?_ex=300x300',
    reviewAverage: 4.6,
    reviewCount: 210,
    affiliate: true,
    ...overrides,
  };
}

function basketWith(...candidates: ProductCandidate[]) {
  const basket = emptyBasket();
  addToBasket(basket, candidates, gearSpecFor('gels', applyProfileUpdate(base(), {
    goal: { kind: 'time', summary: '目標', targetTime: '3:30:00' },
  }, NOW), NOW));
  return basket;
}

describe('名札の差し替え', () => {
  it('モデルが書いた名札が、実際の商品に変わる', () => {
    const basket = basketWith(candidate());
    const text = '補給を決めましょう。\n```product\n{"category":"gels","picks":[{"ref":"p1","why":"胃が弱いと言っていたので"}],"note":"まず3本"}\n```';
    const resolved = resolveProductBlocks(text, basket, NOW);

    expect(resolved).toContain('ジェル 30個セット');
    expect(resolved).toContain('hb.afl.rakuten.co.jp');
    expect(resolved).not.toContain('"ref"');

    const block = parseRichText(resolved).find((entry) => entry.type === 'product');
    expect(block).toBeTruthy();
    expect(block).toMatchObject({ type: 'product' });
  });

  it('カードには、計算した条件と「買わなくていい場合」が載る', () => {
    const basket = basketWith(candidate());
    const resolved = resolveProductBlocks(
      '```product\n{"category":"gels","picks":[{"ref":"p1"}]}\n```',
      basket,
      NOW,
    );
    const block = parseRichText(resolved).find((entry) => entry.type === 'product') as {
      spec?: string[];
      skipIf?: string;
      asOf?: string;
    };

    expect(block.spec?.join('\n')).toContain('6本');
    expect(block.skipIf).toContain('90分');
    expect(block.asOf).toBe('2026-09-24');
  });

  it('強調の記号はカードに持ち込まない', () => {
    const basket = basketWith(candidate());
    const resolved = resolveProductBlocks(
      '```product\n{"category":"gels","picks":[{"ref":"p1","why":"**後半用**に"}],"note":"**3本**"}\n```',
      basket,
      NOW,
    );
    expect(resolved).not.toContain('**');
  });

  it('引けない名札しか無いブロックは、丸ごと消す', () => {
    const basket = basketWith(candidate());
    const text = '本文はここまで。\n\n```product\n{"picks":[{"ref":"p9"}]}\n```\n\n続きの一文。';
    const resolved = resolveProductBlocks(text, basket, NOW);

    expect(resolved).not.toContain('product');
    expect(resolved).toContain('本文はここまで。');
    expect(resolved).toContain('続きの一文。');
  });

  it('差し替え済みの本文は、読み直しても壊れない', () => {
    const basket = basketWith(candidate());
    const once = resolveProductBlocks('```product\n{"picks":[{"ref":"p1"}]}\n```', basket, NOW);
    expect(resolveProductBlocks(once, emptyBasket(), NOW)).toBe(once);
  });

  it('モデルが商品名と価格を自分で書いたブロックは、画面に出さない', () => {
    const invented =
      '```product\n' +
      JSON.stringify({
        items: [{ name: '存在しないシューズ Z', price: 9800, url: 'https://example.com/z' }],
      }) +
      '\n```';
    expect(resolveProductBlocks(invented, basketWith(candidate()), NOW)).toBe('');
  });

  it('生成が途中で切れたブロックは、そのまま残す（消すと本文まで欠ける）', () => {
    const text = 'これから候補を出します。\n```product\n{"picks":[';
    expect(resolveProductBlocks(text, basketWith(candidate()), NOW)).toBe(text);
  });

  it('商品ブロックの無い本文には手を触れない', () => {
    const text = '今日は閾値走です。\n```menu\n{"items":[{"label":"WU"}]}\n```';
    expect(resolveProductBlocks(text, emptyBasket(), NOW)).toBe(text);
  });

  it('名札は、続けて検索しても重ならない', () => {
    const basket = emptyBasket();
    addToBasket(basket, [candidate({ name: '靴 A' })], null);
    const second = addToBasket(basket, [candidate({ name: 'ジェル B' })], null);
    expect(second[0].ref).toBe('p2');
    expect(basket.candidates).toHaveLength(2);
  });
});

describe('商品を勧める時の作法', () => {
  it('商品名・価格・URLを書くなと明言している', () => {
    const text = productDoctrine();
    expect(text).toContain('商品名・型番・価格・URLを自分で書いてはならない');
    expect(text).toContain('find_gear');
    expect(text).toContain('```product');
  });
});

describe('find_gear', () => {
  const env = { RAKUTEN_APP_ID: 'app-id' } as unknown as NodeJS.ProcessEnv;
  const profile = () =>
    applyProfileUpdate(base(), { weeklyVolumeKm: 70, goal: { kind: 'time', summary: 'サブ3', targetTime: '2:59:59' } }, NOW);

  it('条件を計算し、候補に名札を付けて返す', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        Items: [
          {
            Item: {
              itemCode: 'a',
              itemName: '【送料無料】シューズ X',
              itemPrice: 15_400,
              itemUrl: 'https://item.rakuten.co.jp/a/',
              affiliateUrl: 'https://hb.afl.rakuten.co.jp/a/',
              shopName: '店',
              reviewAverage: 4.7,
              reviewCount: 55,
            },
          },
        ],
      }),
    } as unknown as Response);

    const basket = emptyBasket();
    const result = (await runFindGear(profile(), { category: 'shoes-daily' }, basket, NOW, {
      env,
      fetchImpl,
    })) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect((result.requirements as string[]).join('\n')).toContain('2足');
    expect(result.candidates).toEqual([
      { ref: 'p1', name: 'シューズ X', price: 15_400, shop: '店', review: '★4.7（55件）' },
    ]);
    // URLと画像はモデルに渡さない。書き写して間違える余地を残さない。
    expect(JSON.stringify(result)).not.toContain('rakuten.co.jp');
    expect(basket.candidates[0].url).toContain('hb.afl.rakuten.co.jp');
  });

  it('鍵が無い環境では、検索リンクで出すよう伝える', async () => {
    const fetchImpl = vi.fn();
    const result = (await runFindGear(profile(), { category: 'gels' }, emptyBasket(), NOW, {
      env: {} as NodeJS.ProcessEnv,
      fetchImpl,
    })) as Record<string, unknown>;

    expect(result.candidates).toEqual([]);
    expect(String(result.note)).toContain('gear ブロック');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('候補が空なら、商品名を書くなと念を押す', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ Items: [] }) } as unknown as Response);
    const result = (await runFindGear(profile(), { category: 'gels' }, emptyBasket(), NOW, {
      env,
      fetchImpl,
    })) as Record<string, unknown>;

    expect(String(result.note)).toContain('商品名を書いてはならない');
  });

  it('知らないカテゴリは、使える一覧とともに突き返す', async () => {
    const result = (await runFindGear(profile(), { category: 'rocket' }, emptyBasket(), NOW, {
      env,
    })) as Record<string, unknown>;

    expect(result.ok).toBe(false);
    expect(result.usable).toContain('shoes-daily');
  });
});
