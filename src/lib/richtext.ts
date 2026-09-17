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

export type RichBlock =
  | { type: 'paragraph'; content: InlineText[] }
  | { type: 'heading'; content: InlineText[] }
  | { type: 'bullets'; items: InlineText[][] }
  | { type: 'ordered'; items: InlineText[][] }
  | MenuBlock
  | ZonesBlock
  | GearBlock
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

const FENCE = /^```(menu|zones|gear)\s*$/;
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
        fence[1] === 'menu' ? menuFrom(raw) : fence[1] === 'gear' ? gearFrom(raw) : zonesFrom(raw);
      if (parsed) blocks.push(parsed);
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
