import { describe, expect, it, vi } from 'vitest';
import { badGearFor, gearNoteDoctrine, goodGearFor } from '@/lib/gear-notes';
import { excludeNamed, parseCatalogResponse, searchCatalog } from '@/lib/catalog';
import { runFindGear } from '@/lib/gear-tool';
import { emptyBasket } from '@/lib/products';
import { logGearNote } from '@/lib/profile';
import { executeTool } from '@/lib/tools';
import { createDefaultProfile } from '@/lib/types';

const NOW = new Date('2026-09-24T09:00:00Z');
const base = () => createDefaultProfile('u1', NOW.toISOString());
const env = { RAKUTEN_APP_ID: 'app-id' } as unknown as NodeJS.ProcessEnv;

function item(name: string, code = name) {
  return {
    itemCode: code,
    itemName: name,
    itemPrice: 4980,
    itemUrl: `https://item.rakuten.co.jp/${encodeURIComponent(code)}/`,
    affiliateUrl: `https://hb.afl.rakuten.co.jp/${encodeURIComponent(code)}/`,
    shopName: '店',
    reviewAverage: 4.3,
    reviewCount: 40,
  };
}

function mallReturning(...names: string[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ Items: names.map((name) => ({ Item: item(name) })) }),
  } as unknown as Response);
}

describe('合う・合わないの記録', () => {
  it('同じ物について言い直したら、新しい方だけが残る', () => {
    let profile = logGearNote(base(), { name: 'メダリスト', verdict: 'bad', reason: '胃に来た' }, NOW);
    profile = logGearNote(profile, { name: 'メダリスト', verdict: 'good', reason: '薄めたら平気だった' }, NOW);

    expect(profile.gearNotes).toHaveLength(1);
    expect(profile.gearNotes?.[0].verdict).toBe('good');
  });

  it('カテゴリが分かっていれば、そのカテゴリだけで効く', () => {
    const profile = logGearNote(base(), { name: 'A社ジェル', verdict: 'bad', category: 'gels' }, NOW);
    expect(badGearFor(profile, 'gels')).toHaveLength(1);
    expect(badGearFor(profile, 'socks')).toHaveLength(0);
  });

  it('カテゴリ不明の記録は、どのカテゴリでも効く', () => {
    const profile = logGearNote(base(), { name: 'B社', verdict: 'bad' }, NOW);
    expect(badGearFor(profile, 'socks')).toHaveLength(1);
  });

  it('合ったものは、次に思い出させる', () => {
    const profile = logGearNote(base(), { name: 'C社の五本指', verdict: 'good' }, NOW);
    expect(goodGearFor(profile, 'socks')).toHaveLength(1);
  });

  it('ツールから記録すると、外れることを本人に言える形で返る', () => {
    const { profile, result } = executeTool(
      base(),
      'log_gear_feedback',
      { name: 'メダリスト', verdict: 'bad', reason: '胃に来た', category: 'gels' },
      NOW,
    );
    expect(profile.gearNotes?.[0]).toMatchObject({ name: 'メダリスト', verdict: 'bad' });
    expect(String(result.message)).toContain('候補から外れる');
  });

  it('プロンプトでは、二度と勧めないと言い切る', () => {
    const profile = logGearNote(base(), { name: 'メダリスト', verdict: 'bad', reason: '胃に来た' }, NOW);
    const text = gearNoteDoctrine(profile)!;

    expect(text).toContain('メダリスト');
    expect(text).toContain('胃に来た');
    expect(text).toContain('二度と勧めない');
  });

  it('記録が無ければ、何も足さない', () => {
    expect(gearNoteDoctrine(base())).toBeNull();
  });
});

describe('候補から外す', () => {
  it('名前が含まれていれば外す', () => {
    const candidates = parseCatalogResponse({
      Items: [{ Item: item('メダリスト エナジージェル 12個') }, { Item: item('別社 エナジージェル 12個') }],
    });
    const { kept, dropped } = excludeNamed(candidates, ['メダリスト']);

    expect(kept).toHaveLength(1);
    expect(kept[0].name).toContain('別社');
    expect(dropped).toEqual(['メダリスト']);
  });

  it('全角・空白の違いでは取りこぼさない', () => {
    const candidates = parseCatalogResponse({ Items: [{ Item: item('ＭＥＤＡＬＩＳＴ ジェル') }] });
    expect(excludeNamed(candidates, ['medalist']).kept).toHaveLength(0);
  });

  it('1文字の指定では外さない（関係ない商品まで巻き込む）', () => {
    const candidates = parseCatalogResponse({ Items: [{ Item: item('エナジージェル') }] });
    expect(excludeNamed(candidates, ['ル']).kept).toHaveLength(1);
  });

  it('検索の時点で外れる', async () => {
    const fetchImpl = mallReturning('メダリスト ジェル', '別社 ジェル');
    const found = await searchCatalog('エナジージェル', { env, fetchImpl, exclude: ['メダリスト'] });
    expect(found.map((entry) => entry.name)).toEqual(['別社 ジェル']);
  });
});

describe('find_gear と合わせて', () => {
  it('合わなかった物を外し、外したことを言える形で返す', async () => {
    const profile = logGearNote(base(), { name: 'メダリスト', verdict: 'bad', reason: '胃に来た' }, NOW);
    const fetchImpl = mallReturning('メダリスト ジェル', '別社 ジェル');

    const result = (await runFindGear(profile, { category: 'gels' }, emptyBasket(), NOW, {
      env,
      fetchImpl,
    })) as Record<string, unknown>;

    expect(result.excluded).toEqual(['メダリスト（胃に来た）']);
    expect(JSON.stringify(result.candidates)).not.toContain('メダリスト');
    expect(String(result.note)).toContain('除外済み');
  });

  it('合った物があれば、まずそれを思い出させる', async () => {
    const profile = logGearNote(base(), { name: 'C社の五本指', verdict: 'good' }, NOW);
    const result = (await runFindGear(profile, { category: 'socks' }, emptyBasket(), NOW, {
      env,
      fetchImpl: mallReturning('五本指ソックス'),
    })) as Record<string, unknown>;

    expect(result.alreadyWorks).toEqual(['C社の五本指']);
    expect(String(result.note)).toContain('思い出させる');
  });
});
