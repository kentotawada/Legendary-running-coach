/**
 * モデルが選んだ商品を、画面に出せる形に差し替える層。
 *
 * 流れはこうなっています。
 *
 * 1. モデルが find_gear を呼ぶ → アプリがこの人の条件で検索し、実在する候補に名札（p1, p2…）を付けて返す
 * 2. モデルは **名札だけ** を指して「この人にはこれ」と書く
 * 3. ここで名札を、モールから来た本当の名前・価格・リンクに差し替える
 *
 * こうすると、勧める理由はモデルの言葉で、商品の事実はモールの値、という分担になります。
 * モデルがURLや価格を書く余地がそもそも無いので、間違えようがありません。
 */

import type { ProductCandidate } from './catalog';
import type { GearSpec } from './gear-spec';

/** 1回に出す商品の上限。並べるほど選べなくなる。 */
export const MAX_PICKS = 3;

/** 条件はカードに出すが、長すぎると読まれない。 */
const MAX_SPEC_LINES = 3;

export interface ProductBasket {
  /** このターンで検索して得た候補。名札で引く。 */
  candidates: ProductCandidate[];
  /** カテゴリごとの、この人の条件。カードの「この条件で選びました」に使う。 */
  specs: GearSpec[];
}

export function emptyBasket(): ProductBasket {
  return { candidates: [], specs: [] };
}

/** 検索結果をかごに足す。名札は重複しないよう振り直す。 */
export function addToBasket(
  basket: ProductBasket,
  candidates: ProductCandidate[],
  spec: GearSpec | null,
): ProductCandidate[] {
  const offset = basket.candidates.length;
  const renamed = candidates.map((candidate, index) => ({ ...candidate, ref: `p${offset + index + 1}` }));
  basket.candidates.push(...renamed);
  if (spec && !basket.specs.some((entry) => entry.categoryId === spec.categoryId)) basket.specs.push(spec);
  return renamed;
}

/** 強調の記号はカードでは使わない。そのまま出すと ** が画面に残る。 */
function plain(text: string): string {
  return text.replace(/\*\*/g, '').trim();
}

const FENCE_OPEN = /^```product\s*$/;
const FENCE_CLOSE = /^```\s*$/;

interface Pick {
  ref?: unknown;
  why?: unknown;
}

function resolveOne(raw: string, basket: ProductBasket, asOf: string): string | null {
  let data: { picks?: unknown; items?: unknown; note?: unknown; category?: unknown };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    return null;
  }

  // すでに差し替え済み（保存された履歴を読み直した時）はそのまま。
  if (Array.isArray(data.items)) return raw;
  if (!Array.isArray(data.picks)) return null;

  const items = (data.picks as Pick[])
    .map((pick) => {
      const ref = typeof pick.ref === 'string' ? pick.ref.trim() : '';
      const candidate = basket.candidates.find((entry) => entry.ref === ref);
      if (!candidate) return null;
      return {
        name: candidate.name,
        price: candidate.price,
        shop: candidate.shop,
        url: candidate.url,
        image: candidate.imageUrl,
        affiliate: candidate.affiliate,
        reviewAverage: candidate.reviewAverage,
        reviewCount: candidate.reviewCount,
        why: typeof pick.why === 'string' && pick.why.trim() ? plain(pick.why) : undefined,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, MAX_PICKS);

  // 名札が一つも引けなかった。空のカードを残すより、ブロックごと消す。
  if (items.length === 0) return null;

  const category = typeof data.category === 'string' ? data.category : undefined;
  const spec = basket.specs.find((entry) => entry.categoryId === category) ?? basket.specs[0];

  return JSON.stringify({
    items,
    note: typeof data.note === 'string' && data.note.trim() ? plain(data.note) : undefined,
    spec: spec?.requirements.slice(0, MAX_SPEC_LINES).map(plain),
    skipIf: spec ? plain(spec.skipIf) : undefined,
    asOf,
  });
}

/**
 * 本文の中の product ブロックを、実際の商品に差し替える。
 * 引けない名札しか入っていないブロックは、丸ごと取り除く。
 */
export function resolveProductBlocks(text: string, basket: ProductBasket, now: Date = new Date()): string {
  if (!text.includes('```product')) return text;

  const asOf = `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`;
  const lines = text.split('\n');
  const out: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!FENCE_OPEN.test(lines[index])) {
      out.push(lines[index]);
      continue;
    }

    // 閉じるまでを集める。閉じていなければ（生成が途中で終わった）、そのまま残す。
    let end = index + 1;
    const body: string[] = [];
    while (end < lines.length && !FENCE_CLOSE.test(lines[end])) {
      body.push(lines[end]);
      end += 1;
    }
    if (end >= lines.length) {
      out.push(...lines.slice(index));
      break;
    }

    const resolved = resolveOne(body.join('\n'), basket, asOf);
    if (resolved) {
      out.push('```product', resolved, '```');
    } else {
      // 差し替えられないブロックは消す。直前の空行も一緒に畳んでおく。
      while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
    }
    index = end;
  }

  return out.join('\n');
}

/** プロンプトに差し込む、商品を勧める時の作法。 */
export function productDoctrine(): string {
  return [
    '# 具体的な商品を勧める時',
    '- **商品名・型番・価格・URLを自分で書いてはならない。** 記憶にある商品名は古いか、存在しないかのどちらかだと考えること。',
    '- 具体名で勧める価値がある場面では、まず **find_gear** を呼ぶ。',
    '  この人の体・練習・本番までの日数から条件を計算し、実在する商品の候補を名札（p1, p2…）付きで返す。',
    '- 返ってきた候補の中から選び、下のブロックで**名札だけ**を指す。名前と価格とリンクはアプリが埋める。',
    '',
    '```product',
    '{"category":"gels","picks":[{"ref":"p2","why":"胃が弱いと言っていたので、粘度の低いものを後半用に"}],"note":"まず3本だけ試す"}',
    '```',
    '',
    `- picks は最大${MAX_PICKS}件。why には「**この人の**どの事情に効くのか」を書く。一般的な商品説明を書かない。`,
    '- 候補が返ってこなかった時は、この形式を使わず、gear ブロックで検索リンクだけを出す。',
    '  **候補が無いのに商品名を書くことは、どんな理由があっても許されない。**',
    '- 買わなくてよい場合も必ず言う。売るのが目的ではない。カードの下にもその一行が出る。',
  ].join('\n');
}
