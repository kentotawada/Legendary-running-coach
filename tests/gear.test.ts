import { describe, expect, it } from 'vitest';
import {
  GEAR_CATEGORIES,
  affiliateConfigFromEnv,
  amazonSearchUrl,
  gearDoctrine,
  hasAffiliate,
  rakutenSearchUrl,
  resolveGearCatalog,
} from '@/lib/gear';

describe('アフィリエイトリンクの生成', () => {
  it('IDが未設定なら、ただの検索リンクになる（広告だと偽らない）', () => {
    const amazon = amazonSearchUrl('ランニングシューズ');
    const rakuten = rakutenSearchUrl('ランニングシューズ');

    expect(amazon.affiliate).toBe(false);
    expect(rakuten.affiliate).toBe(false);
    expect(amazon.url).not.toContain('tag=');
    expect(hasAffiliate([amazon, rakuten])).toBe(false);
  });

  it('Amazon のタグを付けられる', () => {
    const link = amazonSearchUrl('ランニングウォッチ', 'mytag-22');

    expect(link.affiliate).toBe(true);
    expect(link.url).toContain('tag=mytag-22');
    expect(link.url).toContain(encodeURIComponent('ランニングウォッチ'));
  });

  it('楽天はアフィリエイトIDでリンクを包む', () => {
    const link = rakutenSearchUrl('体組成計', { rakutenId: 'abc123' });

    expect(link.affiliate).toBe(true);
    expect(link.url).toContain('hb.afl.rakuten.co.jp/hgc/abc123/');
  });

  it('楽天のリンク形式は差し替えられる（仕様変更に追随できるように）', () => {
    const link = rakutenSearchUrl('体組成計', {
      rakutenId: 'abc123',
      rakutenTemplate: 'https://example.test/{id}?to={url}',
    });

    expect(link.url.startsWith('https://example.test/abc123?to=')).toBe(true);
  });

  it('検索語はURLエンコードされる', () => {
    expect(amazonSearchUrl('エナジージェル ランニング').url).not.toContain(' ');
  });
});

describe('環境変数の読み取り', () => {
  it('引用符や空白が混ざっていても拾える', () => {
    const config = affiliateConfigFromEnv({
      AMAZON_ASSOCIATE_TAG: ' "mytag-22" ',
      RAKUTEN_AFFILIATE_ID: 'abc123\n',
    } as unknown as NodeJS.ProcessEnv);

    expect(config.amazonTag).toBe('mytag-22');
    expect(config.rakutenId).toBe('abc123');
  });

  it('未設定なら undefined', () => {
    expect(affiliateConfigFromEnv({} as unknown as NodeJS.ProcessEnv).amazonTag).toBeUndefined();
  });
});

describe('カタログ', () => {
  it('すべてのカテゴリに、いつ検討するかの説明がある', () => {
    for (const category of GEAR_CATEGORIES) {
      expect(category.why.length).toBeGreaterThan(15);
      expect(category.query.length).toBeGreaterThan(3);
    }
  });

  it('id が重複していない', () => {
    const ids = GEAR_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('毎日はかる習慣を支える体重計が含まれている', () => {
    expect(GEAR_CATEGORIES.some((c) => c.id === 'scale')).toBe(true);
  });

  it('カタログを解決すると、各カテゴリに2つのリンクが付く', () => {
    const catalog = resolveGearCatalog({ amazonTag: 'mytag-22' });

    expect(catalog).toHaveLength(GEAR_CATEGORIES.length);
    for (const item of catalog) {
      expect(item.links).toHaveLength(2);
    }
  });
});

describe('gearDoctrine', () => {
  it('商品名と価格をモデルに書かせない', () => {
    const text = gearDoctrine();

    expect(text).toContain('商品名・型番・価格を自分で書いてはならない');
    expect(text).toContain('聞かれてもいないのに勧めない');
  });

  it('使えるカテゴリidを列挙している', () => {
    const text = gearDoctrine();
    for (const category of GEAR_CATEGORIES) {
      expect(text).toContain(category.id);
    }
  });
});
