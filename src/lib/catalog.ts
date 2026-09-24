/**
 * 実在する商品の候補を取ってくる層。
 *
 * **モデルに商品名・型番・価格を書かせてはならない。** これは最初から変えていない方針です。
 * 存在しないシューズや、2年前の価格を自信たっぷりに書かれたら、
 * それを信じて買い物をした人が損をします。
 *
 * かといってカテゴリ名と検索リンクだけでは「で、どれを買えばいいの」に答えられません。
 * そこで、商品の一覧だけはモールの API から取り、
 * **その中から選ぶ**という形にします。名前と価格の出所は常にモールで、モデルではありません。
 *
 * 楽天市場の商品検索 API を使っているのは、
 * アフィリエイトリンク（affiliateUrl）が検索結果にそのまま含まれていて、
 * 売上実績が無いうちから使えるためです。
 * 鍵（RAKUTEN_APP_ID）が無い環境では何も取らず、従来の検索リンクに落ちます。
 */

const ENDPOINT = 'https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601';

/** 1回の呼び出しで取る件数。この中から絞り込む。 */
const FETCH_HITS = 20;

/** モデルに見せる候補の数。多すぎると選べず、少なすぎると外れる。 */
export const DEFAULT_CANDIDATE_LIMIT = 5;

/** 検索が遅い時に、対話そのものを待たせない上限。 */
const TIMEOUT_MS = 6_000;

export interface ProductCandidate {
  /** モデルが指し示すための短い名札。URLを書かせないための仕組み。 */
  ref: string;
  /** モール側の商品コード。 */
  id: string;
  name: string;
  price: number;
  shop: string;
  url: string;
  imageUrl?: string;
  reviewAverage?: number;
  reviewCount?: number;
  /** アフィリエイトリンクかどうか。表示の出し分けに使う。 */
  affiliate: boolean;
}

export interface CatalogConfig {
  appId?: string;
  affiliateId?: string;
}

function clean(value: string | undefined): string | undefined {
  return value?.trim().replace(/^["']|["']$/g, '').trim() || undefined;
}

export function catalogConfigFromEnv(env: NodeJS.ProcessEnv = process.env): CatalogConfig {
  return {
    appId: clean(env.RAKUTEN_APP_ID),
    // アフィリエイトIDは楽天の管理画面の形式に合わせて、そのまま渡す。
    affiliateId: clean(env.RAKUTEN_AFFILIATE_ID),
  };
}

export function isCatalogConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(catalogConfigFromEnv(env).appId);
}

/**
 * 商品名から、モールの飾りを落とす。
 * 「【送料無料】【あす楽】」で始まる名前は、どれも同じに見えて選べない。
 */
export function tidyName(raw: string): string {
  const stripped = raw
    .replace(/[【\[][^】\]]*[】\]]/g, ' ')
    .replace(/[（(](?:送料無料|あす楽|ポイント\d+倍)[)）]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const name = stripped || raw.trim();
  return name.length > 64 ? `${name.slice(0, 63)}…` : name;
}

/** 同じ商品が別の店から何件も並ぶのを防ぐための鍵。 */
function dedupeKey(name: string): string {
  return tidyName(name)
    .toLowerCase()
    .replace(/[\s・,，.。/|-]/g, '')
    .slice(0, 18);
}

/** サムネイルを、カードに出して粗くならない大きさで取る。 */
function bigger(imageUrl: string | undefined): string | undefined {
  if (!imageUrl) return undefined;
  return imageUrl.replace(/_ex=\d+x\d+/, '_ex=300x300');
}

interface RawItem {
  itemCode?: unknown;
  itemName?: unknown;
  itemPrice?: unknown;
  itemUrl?: unknown;
  affiliateUrl?: unknown;
  shopName?: unknown;
  reviewAverage?: unknown;
  reviewCount?: unknown;
  mediumImageUrls?: unknown;
  smallImageUrls?: unknown;
}

function numberOf(value: unknown): number | undefined {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined;
}

function firstImage(item: RawItem): string | undefined {
  for (const list of [item.mediumImageUrls, item.smallImageUrls]) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (typeof entry === 'string') return entry;
      const url = (entry as { imageUrl?: unknown })?.imageUrl;
      if (typeof url === 'string' && url) return url;
    }
  }
  return undefined;
}

/**
 * API の応答から候補を組み立てる。
 * 応答の形（Items[].Item で包むか、そのまま並ぶか）は版によって違うので、両方受ける。
 */
export function parseCatalogResponse(json: unknown, startRef = 1): ProductCandidate[] {
  const items = (json as { Items?: unknown })?.Items;
  if (!Array.isArray(items)) return [];

  const candidates: ProductCandidate[] = [];
  const seen = new Set<string>();

  for (const entry of items) {
    const item = ((entry as { Item?: unknown })?.Item ?? entry) as RawItem;
    const name = typeof item.itemName === 'string' ? item.itemName : '';
    const price = numberOf(item.itemPrice);
    const url =
      (typeof item.affiliateUrl === 'string' && item.affiliateUrl) ||
      (typeof item.itemUrl === 'string' && item.itemUrl) ||
      '';
    if (!name || !url || price === undefined || price <= 0) continue;

    const key = dedupeKey(name);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);

    candidates.push({
      ref: `p${startRef + candidates.length}`,
      id: typeof item.itemCode === 'string' ? item.itemCode : url,
      name: tidyName(name),
      price: Math.round(price),
      shop: typeof item.shopName === 'string' ? item.shopName : '楽天市場',
      url,
      imageUrl: bigger(firstImage(item)),
      reviewAverage: numberOf(item.reviewAverage),
      reviewCount: numberOf(item.reviewCount),
      affiliate: typeof item.affiliateUrl === 'string' && item.affiliateUrl.length > 0,
    });
  }

  return candidates;
}

/**
 * レビューが付いているものを前に出す。
 * 並び自体はモールの関連度順を尊重する。検索語との一致は、こちらでは測れない。
 */
export function rankCandidates(candidates: ProductCandidate[], limit: number): ProductCandidate[] {
  const trusted = candidates.filter(
    (item) => (item.reviewCount ?? 0) >= 3 && (item.reviewAverage ?? 0) >= 3.5,
  );
  const rest = candidates.filter((item) => !trusted.includes(item));
  return [...trusted, ...rest].slice(0, limit).map((item, index) => ({ ...item, ref: `p${index + 1}` }));
}

export interface SearchOptions {
  limit?: number;
  minPrice?: number;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * 商品を探す。
 *
 * **ここで失敗しても対話は止めない。** 道具の候補が出ないことと、
 * コーチが返事をしないことは、重さがまるで違う。
 */
export async function searchCatalog(
  query: string,
  options: SearchOptions = {},
): Promise<ProductCandidate[]> {
  const {
    limit = DEFAULT_CANDIDATE_LIMIT,
    minPrice,
    env = process.env,
    // そのまま渡さず包むのは、実行環境によっては fetch を単体で呼べないため。
    fetchImpl = (...args: Parameters<typeof fetch>) => fetch(...args),
    timeoutMs = TIMEOUT_MS,
  } = options;

  const config = catalogConfigFromEnv(env);
  if (!config.appId || !query.trim()) return [];

  const params = new URLSearchParams({
    format: 'json',
    applicationId: config.appId,
    keyword: query.trim(),
    hits: String(FETCH_HITS),
    page: '1',
    imageFlag: '1',
    availability: '1',
    sort: 'standard',
  });
  if (config.affiliateId) params.set('affiliateId', config.affiliateId);
  if (minPrice !== undefined) params.set('minPrice', String(Math.round(minPrice)));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${ENDPOINT}?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      // 本文まで残す。楽天は理由（wrong_parameter など）を本文で返すので、
      // 状態番号だけでは「IDが違うのか、混んでいるのか」が切り分けられない。
      const body = await response.text().catch(() => '');
      console.warn(`[coach] 商品検索が ${response.status} を返しました: ${body.slice(0, 200)}`);
      return [];
    }
    const json = (await response.json()) as unknown;
    return rankCandidates(parseCatalogResponse(json), limit);
  } catch (error) {
    console.warn('[coach] 商品検索に失敗しました', error);
    return [];
  } finally {
    clearTimeout(timer);
  }
}
