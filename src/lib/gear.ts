/**
 * ランニング用品の提案。
 *
 * 大事な前提が2つある。
 *
 * 1. **モデルに商品名や価格を作らせない。** 存在しない商品や古い価格を出すと、
 *    そのままランナーの買い物を誤らせる。ここで持つのはカテゴリと検索条件だけで、
 *    実際の商品は各モールの検索結果に委ねる。
 * 2. **アフィリエイトであることを必ず表示する。** 景品表示法のステマ規制により、
 *    広告であることを隠した表示は禁止されている。リンクの出所を隠さない。
 */

export interface GearCategory {
  id: string;
  title: string;
  /** どんな時に検討する物か。コーチが勧める判断材料。 */
  why: string;
  /** 各モールで検索する語。 */
  query: string;
}

export const GEAR_CATEGORIES: GearCategory[] = [
  {
    id: 'shoes-daily',
    title: '練習用シューズ（デイリートレーナー）',
    why: '走行距離が増えてきた時。1足を使い続けるより、2足を交互に履く方がソールが回復し、故障も減る',
    query: 'ランニングシューズ デイリートレーナー',
  },
  {
    id: 'shoes-race',
    title: 'レース用シューズ',
    why: '本番が近づき、レースペースでの練習が始まった時。練習で必ず試してから本番に使う',
    query: 'ランニングシューズ レース 厚底 カーボン',
  },
  {
    id: 'watch',
    title: 'ランニングウォッチ',
    why: 'ペースと心拍を同時に見たい時。心拍ゾーンで練習を管理するなら、ほぼ必須の道具',
    query: 'ランニングウォッチ GPS 心拍',
  },
  {
    id: 'hrm',
    title: '心拍センサー（チェストストラップ）',
    why: '手首の光学式心拍が不安定な時。インターバルなど心拍が急に動く練習では精度差が大きい',
    query: 'ランニング 心拍センサー チェストストラップ',
  },
  {
    id: 'gels',
    title: 'エナジージェル・補給食',
    why: '90分を超える練習やレースの前に。本番で初めて使わず、ロング走で必ず試しておく',
    query: 'エナジージェル ランニング 補給',
  },
  {
    id: 'scale',
    title: '体組成計（体重計）',
    why: '毎日はかる習慣をつけたい時。体重だけでなく体脂肪率や水分の変化も見えると、疲労の判断材料が増える',
    query: '体組成計 体重計 スマホ連携',
  },
  {
    id: 'socks',
    title: 'ランニングソックス',
    why: 'マメや靴擦れが出る時。厚みとフィットを変えるだけで解決することが多い',
    query: 'ランニングソックス 五本指 マラソン',
  },
  {
    id: 'care',
    title: 'ケア用品（フォームローラーなど）',
    why: '張りが抜けにくい時、故障からの回復期に。走れない期間にできることを増やす',
    query: 'フォームローラー ストレッチポール ランニング ケア',
  },
];

export const GEAR_CATEGORY_IDS = GEAR_CATEGORIES.map((category) => category.id);

export interface GearLink {
  /** 表示名。 */
  shop: string;
  url: string;
  /** アフィリエイトリンクかどうか。表示の出し分けに使う。 */
  affiliate: boolean;
}

export interface ResolvedGear extends GearCategory {
  links: GearLink[];
}

export interface AffiliateConfig {
  amazonTag?: string;
  rakutenId?: string;
  /** 楽天のリンク形式を上書きしたい場合。{url} と {id} を差し込む。 */
  rakutenTemplate?: string;
}

export function amazonSearchUrl(query: string, tag?: string): GearLink {
  const base = `https://www.amazon.co.jp/s?k=${encodeURIComponent(query)}`;
  return tag
    ? { shop: 'Amazon', url: `${base}&tag=${encodeURIComponent(tag)}`, affiliate: true }
    : { shop: 'Amazon', url: base, affiliate: false };
}

export function rakutenSearchUrl(query: string, config: AffiliateConfig = {}): GearLink {
  const base = `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(query)}/`;
  const { rakutenId, rakutenTemplate } = config;
  if (!rakutenId) return { shop: '楽天市場', url: base, affiliate: false };

  const url = rakutenTemplate
    ? rakutenTemplate.replaceAll('{url}', encodeURIComponent(base)).replaceAll('{id}', rakutenId)
    : `https://hb.afl.rakuten.co.jp/hgc/${rakutenId}/?pc=${encodeURIComponent(base)}&m=${encodeURIComponent(base)}`;

  return { shop: '楽天市場', url, affiliate: true };
}

export function resolveGear(category: GearCategory, config: AffiliateConfig): ResolvedGear {
  return {
    ...category,
    links: [amazonSearchUrl(category.query, config.amazonTag), rakutenSearchUrl(category.query, config)],
  };
}

export function resolveGearCatalog(config: AffiliateConfig): ResolvedGear[] {
  return GEAR_CATEGORIES.map((category) => resolveGear(category, config));
}

/** 環境変数から設定を読む。未設定なら、ただの検索リンクとして扱う。 */
export function affiliateConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AffiliateConfig {
  const clean = (value: string | undefined) => value?.trim().replace(/^["']|["']$/g, '').trim() || undefined;
  return {
    amazonTag: clean(env.AMAZON_ASSOCIATE_TAG),
    rakutenId: clean(env.RAKUTEN_AFFILIATE_ID),
    rakutenTemplate: clean(env.RAKUTEN_LINK_TEMPLATE),
  };
}

export function hasAffiliate(links: GearLink[]): boolean {
  return links.some((link) => link.affiliate);
}

/** プロンプトに差し込む、道具の提案ルール。 */
export function gearDoctrine(): string {
  return [
    '# 道具を勧める時',
    '- **商品名・型番・価格を自分で書いてはならない。** 存在しない商品や古い価格を出すと、買い物を誤らせる。',
    '- 道具の話が本当に役に立つ場面（走行距離が増えた、マメが出る、心拍を測りたい、毎日はかりたい等）でのみ触れる。',
    '  聞かれてもいないのに勧めない。コーチは販売員ではない。',
    '- **具体的な商品名で答えた方が親切な場面（どのジェル、どのシューズ）では、まず find_gear を呼ぶこと。**',
    '  「具体的な商品を勧める時」に書いてある手順で、この人の条件に合う実在の候補が返る。',
    '- カテゴリを示すだけで足りる場面、または find_gear で候補が返らなかった場面では、',
    '  下のブロックでカテゴリの id だけを出す。リンクはアプリが用意する。',
    '',
    '```gear',
    '{"categories":["shoes-daily"],"note":"週70kmまで来たので、2足を交互に履く運用にしたい"}',
    '```',
    '',
    `- 使える id: ${GEAR_CATEGORIES.map((c) => c.id).join(' / ')}`,
    '- note には「なぜ今これなのか」をこの人の状況に即して一言で書く。一般論を書かない。',
    '- 一度に出すカテゴリは2つまで。',
  ].join('\n');
}
