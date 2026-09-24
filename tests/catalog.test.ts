import { describe, expect, it, vi } from 'vitest';
import {
  isCatalogConfigured,
  parseCatalogResponse,
  rankCandidates,
  searchCatalog,
  tidyName,
} from '@/lib/catalog';

function item(overrides: Record<string, unknown> = {}) {
  return {
    itemCode: 'shop:1',
    itemName: '【送料無料】ランニングシューズ A1',
    itemPrice: 13_200,
    itemUrl: 'https://item.rakuten.co.jp/shop/1/',
    affiliateUrl: 'https://hb.afl.rakuten.co.jp/hgc/xxxx/',
    shopName: 'スポーツ店',
    reviewAverage: 4.5,
    reviewCount: 120,
    mediumImageUrls: [{ imageUrl: 'https://thumbnail.image.rakuten.co.jp/a.jpg?_ex=128x128' }],
    ...overrides,
  };
}

describe('商品名の整理', () => {
  it('モールの飾りを落とす', () => {
    expect(tidyName('【送料無料】【あす楽】ランニングシューズ A1 26.5cm')).toBe('ランニングシューズ A1 26.5cm');
  });

  it('飾りしか無い名前は、元の名前を残す', () => {
    expect(tidyName('【送料無料】')).toBe('【送料無料】');
  });

  it('長すぎる名前は切る（カードから溢れる）', () => {
    expect(tidyName('あ'.repeat(200)).length).toBeLessThanOrEqual(64);
  });
});

describe('応答の読み取り', () => {
  it('Item で包まれた形を読む', () => {
    const parsed = parseCatalogResponse({ Items: [{ Item: item() }] });
    expect(parsed).toHaveLength(1);
    expect(parsed[0].ref).toBe('p1');
    expect(parsed[0].name).toBe('ランニングシューズ A1');
    expect(parsed[0].price).toBe(13_200);
    expect(parsed[0].affiliate).toBe(true);
    expect(parsed[0].url).toContain('hb.afl.rakuten.co.jp');
  });

  it('包まれていない形も読む（版によって形が違う）', () => {
    expect(parseCatalogResponse({ Items: [item()] })).toHaveLength(1);
  });

  it('画像は、カードで粗くならない大きさで取る', () => {
    expect(parseCatalogResponse({ Items: [item()] })[0].imageUrl).toContain('_ex=300x300');
  });

  it('アフィリエイトリンクが無ければ、広告だと偽らない', () => {
    const parsed = parseCatalogResponse({ Items: [item({ affiliateUrl: undefined })] });
    expect(parsed[0].affiliate).toBe(false);
    expect(parsed[0].url).toContain('item.rakuten.co.jp');
  });

  it('同じ商品が別の店から並んでも、1件にまとめる', () => {
    const parsed = parseCatalogResponse({
      Items: [
        { Item: item() },
        { Item: item({ itemCode: 'other:2', shopName: '別の店', itemPrice: 12_800 }) },
      ],
    });
    expect(parsed).toHaveLength(1);
  });

  it('名前・価格・リンクの欠けたものは捨てる', () => {
    const parsed = parseCatalogResponse({
      Items: [
        { Item: item({ itemName: '' }) },
        { Item: item({ itemCode: 'b', itemName: '別物 B', itemPrice: 0 }) },
        { Item: item({ itemCode: 'c', itemName: '別物 C', itemUrl: '', affiliateUrl: '' }) },
      ],
    });
    expect(parsed).toHaveLength(0);
  });

  it('応答の形が違えば、空で返す（例外を投げない）', () => {
    expect(parseCatalogResponse({ error: 'wrong_parameter' })).toEqual([]);
    expect(parseCatalogResponse(null)).toEqual([]);
  });
});

describe('候補の並び', () => {
  it('レビューのある物を前に出し、名札を振り直す', () => {
    const parsed = parseCatalogResponse({
      Items: [
        { Item: item({ itemCode: 'a', itemName: '新作 A', reviewCount: 0, reviewAverage: 0 }) },
        { Item: item({ itemCode: 'b', itemName: '定番 B', reviewCount: 80, reviewAverage: 4.4 }) },
      ],
    });
    const ranked = rankCandidates(parsed, 5);

    expect(ranked.map((entry) => entry.name)).toEqual(['定番 B', '新作 A']);
    expect(ranked.map((entry) => entry.ref)).toEqual(['p1', 'p2']);
  });

  it('件数を絞る', () => {
    const many = Array.from({ length: 9 }, (_, index) =>
      item({ itemCode: `c${index}`, itemName: `商品 ${index}` }),
    );
    expect(rankCandidates(parseCatalogResponse({ Items: many }), 4)).toHaveLength(4);
  });
});

describe('商品検索', () => {
  const env = { RAKUTEN_APP_ID: 'app-id', RAKUTEN_AFFILIATE_ID: 'aff-id' } as unknown as NodeJS.ProcessEnv;

  it('鍵が無ければ、外へ問い合わせない', async () => {
    const fetchImpl = vi.fn();
    expect(isCatalogConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(await searchCatalog('シューズ', { env: {} as NodeJS.ProcessEnv, fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('アフィリエイトIDと検索語を載せて呼ぶ', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ Items: [{ Item: item() }] }),
    } as unknown as Response);

    const found = await searchCatalog('ランニングシューズ ワイド', { env, fetchImpl });
    const url = String(fetchImpl.mock.calls[0][0]);

    expect(url).toContain('applicationId=app-id');
    expect(url).toContain('affiliateId=aff-id');
    expect(new URL(url).searchParams.get('keyword')).toBe('ランニングシューズ ワイド');
    expect(found[0].name).toBe('ランニングシューズ A1');
  });

  it('モール側が失敗しても、対話を止めない', async () => {
    const failing = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"error":"wrong_parameter","error_description":"affiliateId"}',
    } as unknown as Response);
    expect(await searchCatalog('ジェル', { env, fetchImpl: failing })).toEqual([]);

    const throwing = vi.fn().mockRejectedValue(new Error('network down'));
    expect(await searchCatalog('ジェル', { env, fetchImpl: throwing })).toEqual([]);
  });

  it('応答が遅い時は待ち続けない', async () => {
    const hanging = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    expect(
      await searchCatalog('シューズ', { env, fetchImpl: hanging as unknown as typeof fetch, timeoutMs: 10 }),
    ).toEqual([]);
  });
});
