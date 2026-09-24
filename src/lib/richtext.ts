/**
 * コーチの返答を、画面に出せる形に解釈する。
 *
 * モデルは放っておくと ** や # をそのまま書いてくる。
 * それを記号のまま見せるのは、本文の読みやすさをそのまま損なう。
 * ここで構造として取り出し、装飾は画面側のスタイルで表現する。
 *
 * 併せて、練習メニューと心拍ゾーンは専用のカードとして描けるよう、
 * モデルが囲みブロックで出した内容を取り出す。
 */

export interface InlineText {
  type: 'text' | 'bold' | 'code';
  value: string;
}

export interface MenuItem {
  label: string;
  detail?: string;
}

export interface MenuBlock {
  type: 'menu';
  title?: string;
  items: MenuItem[];
  note?: string;
}

export interface ZoneRow {
  zone: string;
  name?: string;
  range?: string;
  note?: string;
}

export interface ZonesBlock {
  type: 'zones';
  basis?: string;
  rows: ZoneRow[];
}

export interface GearBlock {
  type: 'gear';
  categories: string[];
  note?: string;
}

/**
 * 実際の商品。
 * 名前・価格・リンクはモールから来た値で、モデルが書いたものではない。
 * （モデルは名札だけを出し、サーバー側でここに差し替えている）
 */
export interface ProductItem {
  name: string;
  url: string;
  price?: number;
  shop?: string;
  image?: string;
  /** その人にとってなぜこれなのか。ここだけがモデルの言葉。 */
  why?: string;
  affiliate?: boolean;
  reviewAverage?: number;
  reviewCount?: number;
}

export interface ProductBlock {
  type: 'product';
  items: ProductItem[];
  note?: string;
  /** どの条件で選んだか。カルテから計算した値。 */
  spec?: string[];
  /** 買わなくてよい場合。 */
  skipIf?: string;
  /** 価格を見た日。値段は動くので、いつの値かを必ず添える。 */
  asOf?: string;
}

/**
 * 本番の持ち物と段取り。
 * 中身はカルテから計算したもので、モデルが書いたものではない。
 */
export interface ChecklistItem {
  label: string;
  detail?: string;
}

export interface ChecklistSection {
  title: string;
  items: ChecklistItem[];
}

export interface ChecklistBlock {
  type: 'checklist';
  race: string;
  date?: string;
  daysLeft?: number;
  sections: ChecklistSection[];
  /** チェックの状態を端末に覚えさせるための鍵。 */
  key?: string;
}

/** 説明図。中身は id だけで、絵と手順はアプリ側が持っている。 */
export interface FigureBlock {
  type: 'figure';
  id: string;
  /** その人の状況に合わせた一言。図の下に出す。 */
  note?: string;
}

export type RichBlock =
  | { type: 'paragraph'; content: InlineText[] }
  | { type: 'heading'; content: InlineText[] }
  | { type: 'bullets'; items: InlineText[][] }
  | { type: 'ordered'; items: InlineText[][] }
  | MenuBlock
  | ZonesBlock
  | GearBlock
  | ProductBlock
  | ChecklistBlock
  | FigureBlock
  /** 生成途中の囲みブロック。閉じるまでは中身を出さない。 */
  | { type: 'pending' };

/** 太字とコードだけを解釈する。閉じていない ** は、続きが来る前提で太字として扱う。 */
export function parseInline(text: string): InlineText[] {
  const parts: InlineText[] = [];
  const pattern = /\*\*([\s\S]*?)\*\*|`([^`]*)`|\*\*([\s\S]*)$/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push({ type: 'text', value: text.slice(last, match.index) });
    if (match[1] !== undefined) parts.push({ type: 'bold', value: match[1] });
    else if (match[2] !== undefined) parts.push({ type: 'code', value: match[2] });
    else if (match[3] !== undefined) parts.push({ type: 'bold', value: match[3] });
    last = pattern.lastIndex;
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });

  return parts.filter((part) => part.value.length > 0);
}

const FENCE = /^```(menu|zones|gear|product|checklist|figure)\s*$/;
const BULLET = /^\s*(?:[-*・]|●)\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

function menuFrom(raw: string): MenuBlock | null {
  try {
    const data = JSON.parse(raw) as { title?: unknown; items?: unknown; note?: unknown };
    if (!Array.isArray(data.items)) return null;
    const items = data.items
      .map((item): MenuItem | null => {
        if (typeof item === 'string') return { label: item };
        const record = item as { label?: unknown; detail?: unknown };
        return typeof record.label === 'string'
          ? { label: record.label, detail: typeof record.detail === 'string' ? record.detail : undefined }
          : null;
      })
      .filter((item): item is MenuItem => item !== null);
    if (items.length === 0) return null;
    return {
      type: 'menu',
      title: typeof data.title === 'string' ? data.title : undefined,
      items,
      note: typeof data.note === 'string' ? data.note : undefined,
    };
  } catch {
    return null;
  }
}

function gearFrom(raw: string): GearBlock | null {
  try {
    const data = JSON.parse(raw) as { categories?: unknown; note?: unknown };
    if (!Array.isArray(data.categories)) return null;
    const categories = data.categories.filter((id): id is string => typeof id === 'string');
    if (categories.length === 0) return null;
    return {
      type: 'gear',
      categories,
      note: typeof data.note === 'string' ? data.note : undefined,
    };
  } catch {
    return null;
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function productFrom(raw: string): ProductBlock | null {
  try {
    const data = JSON.parse(raw) as {
      items?: unknown;
      note?: unknown;
      spec?: unknown;
      skipIf?: unknown;
      asOf?: unknown;
    };
    if (!Array.isArray(data.items)) return null;

    const items = data.items
      .map((entry): ProductItem | null => {
        const item = entry as Record<string, unknown>;
        const name = typeof item.name === 'string' ? item.name.trim() : '';
        const url = typeof item.url === 'string' ? item.url.trim() : '';
        // リンク先は必ず http(s)。それ以外の形の文字列は表示しない。
        if (!name || !/^https?:\/\//i.test(url)) return null;
        return {
          name,
          url,
          price: numberOrUndefined(item.price),
          shop: typeof item.shop === 'string' ? item.shop : undefined,
          image: typeof item.image === 'string' && /^https?:\/\//i.test(item.image) ? item.image : undefined,
          why: typeof item.why === 'string' && item.why.trim() ? item.why.trim() : undefined,
          affiliate: item.affiliate === true,
          reviewAverage: numberOrUndefined(item.reviewAverage),
          reviewCount: numberOrUndefined(item.reviewCount),
        };
      })
      .filter((item): item is ProductItem => item !== null);

    if (items.length === 0) return null;

    const spec = Array.isArray(data.spec)
      ? data.spec.filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
      : undefined;

    return {
      type: 'product',
      items,
      note: typeof data.note === 'string' && data.note.trim() ? data.note.trim() : undefined,
      spec: spec && spec.length > 0 ? spec : undefined,
      skipIf: typeof data.skipIf === 'string' && data.skipIf.trim() ? data.skipIf.trim() : undefined,
      asOf: typeof data.asOf === 'string' ? data.asOf : undefined,
    };
  } catch {
    return null;
  }
}

function checklistFrom(raw: string): ChecklistBlock | null {
  try {
    const data = JSON.parse(raw) as {
      race?: unknown;
      date?: unknown;
      daysLeft?: unknown;
      sections?: unknown;
      key?: unknown;
    };
    if (!Array.isArray(data.sections)) return null;

    const sections = data.sections
      .map((entry): ChecklistSection | null => {
        const section = entry as { title?: unknown; items?: unknown };
        if (typeof section.title !== 'string' || !Array.isArray(section.items)) return null;
        const items = section.items
          .map((item): ChecklistItem | null => {
            if (typeof item === 'string') return { label: item };
            const record = item as { label?: unknown; detail?: unknown };
            return typeof record.label === 'string' && record.label.trim()
              ? {
                  label: record.label,
                  detail: typeof record.detail === 'string' ? record.detail : undefined,
                }
              : null;
          })
          .filter((item): item is ChecklistItem => item !== null);
        return items.length > 0 ? { title: section.title, items } : null;
      })
      .filter((section): section is ChecklistSection => section !== null);

    if (sections.length === 0) return null;

    return {
      type: 'checklist',
      race: typeof data.race === 'string' ? data.race : '本番',
      date: typeof data.date === 'string' ? data.date : undefined,
      daysLeft: typeof data.daysLeft === 'number' ? data.daysLeft : undefined,
      sections,
      key: typeof data.key === 'string' ? data.key : undefined,
    };
  } catch {
    return null;
  }
}

function figureFrom(raw: string): FigureBlock | null {
  try {
    const data = JSON.parse(raw) as { id?: unknown; note?: unknown };
    if (typeof data.id !== 'string' || !data.id.trim()) return null;
    return {
      type: 'figure',
      id: data.id.trim(),
      note: typeof data.note === 'string' && data.note.trim() ? data.note.trim() : undefined,
    };
  } catch {
    return null;
  }
}

function zonesFrom(raw: string): ZonesBlock | null {
  try {
    const data = JSON.parse(raw) as { basis?: unknown; rows?: unknown };
    if (!Array.isArray(data.rows)) return null;
    const rows = data.rows
      .map((row): ZoneRow | null => {
        const record = row as { zone?: unknown; name?: unknown; range?: unknown; note?: unknown };
        return typeof record.zone === 'string'
          ? {
              zone: record.zone,
              name: typeof record.name === 'string' ? record.name : undefined,
              range: typeof record.range === 'string' ? record.range : undefined,
              note: typeof record.note === 'string' ? record.note : undefined,
            }
          : null;
      })
      .filter((row): row is ZoneRow => row !== null);
    if (rows.length === 0) return null;
    return { type: 'zones', basis: typeof data.basis === 'string' ? data.basis : undefined, rows };
  } catch {
    return null;
  }
}

/**
 * 本文をブロックに分解する。
 * 壊れた囲みブロックは、JSON を生で見せるより本文として扱う方がまだ読める。
 */
export function parseRichText(text: string): RichBlock[] {
  const lines = text.split('\n');
  const blocks: RichBlock[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];
  let ordered: string[] = [];

  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', content: parseInline(paragraph.join('\n')) });
      paragraph = [];
    }
    if (bullets.length > 0) {
      blocks.push({ type: 'bullets', items: bullets.map(parseInline) });
      bullets = [];
    }
    if (ordered.length > 0) {
      blocks.push({ type: 'ordered', items: ordered.map(parseInline) });
      ordered = [];
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = line.match(FENCE);

    if (fence) {
      flush();
      const body: string[] = [];
      let closed = false;
      let j = i + 1;
      for (; j < lines.length; j += 1) {
        if (lines[j].trim() === '```') {
          closed = true;
          break;
        }
        body.push(lines[j]);
      }
      i = closed ? j : lines.length;

      if (!closed) {
        // まだ生成途中。閉じるまでは中身を見せない。
        blocks.push({ type: 'pending' });
        break;
      }

      const raw = body.join('\n').trim();
      const parsed =
        fence[1] === 'menu'
          ? menuFrom(raw)
          : fence[1] === 'gear'
            ? gearFrom(raw)
            : fence[1] === 'product'
              ? productFrom(raw)
              : fence[1] === 'checklist'
                ? checklistFrom(raw)
                : fence[1] === 'figure'
                  ? figureFrom(raw)
                  : zonesFrom(raw);
      if (parsed) blocks.push(parsed);
      // 商品と持ち物のブロックは、サーバーが中身を埋める前の状態が一瞬だけ通る。
      // 中身の JSON を本文として出してしまうと、その一瞬が画面に残る。
      else if (fence[1] === 'product' || fence[1] === 'checklist') blocks.push({ type: 'pending' });
      else if (raw) blocks.push({ type: 'paragraph', content: parseInline(raw) });
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      flush();
      blocks.push({ type: 'heading', content: parseInline(heading[1]) });
      continue;
    }

    const bullet = line.match(BULLET);
    if (bullet) {
      if (paragraph.length > 0 || ordered.length > 0) flush();
      bullets.push(bullet[1]);
      continue;
    }

    const order = line.match(ORDERED);
    if (order) {
      if (paragraph.length > 0 || bullets.length > 0) flush();
      ordered.push(order[1]);
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    if (bullets.length > 0 || ordered.length > 0) flush();
    paragraph.push(line);
  }

  flush();
  return blocks;
}
