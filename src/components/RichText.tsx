import type { FigureBlock, GearBlock, InlineText, MenuBlock, RichBlock, ZonesBlock } from '@/lib/richtext';
import { FIGURE_CATEGORY_LABEL, findFigure } from '@/lib/figures';
import { figureArt } from './FigureArt';
import { parseInline, parseRichText } from '@/lib/richtext';
import { stripToolTextForDisplay } from '@/lib/tool-text';
import type { ResolvedGear } from '@/lib/gear';
import { hasAffiliate } from '@/lib/gear';

function Inline({ parts }: { parts: InlineText[] }) {
  return (
    <>
      {parts.map((part, index) => {
        if (part.type === 'bold') {
          return (
            <strong key={index} className="font-bold">
              {part.value}
            </strong>
          );
        }
        if (part.type === 'code') {
          return (
            <code key={index} className="rounded bg-sunken px-1 py-0.5 text-[0.92em] tabular-nums">
              {part.value}
            </code>
          );
        }
        return <span key={index}>{part.value}</span>;
      })}
    </>
  );
}

/** 練習メニューは、手順として縦に読めた方が速い。 */
function MenuCard({ block }: { block: MenuBlock }) {
  return (
    <div className="my-2 overflow-hidden rounded-[14px] border border-line bg-bg">
      {block.title && (
        <p className="border-b border-line bg-accent-soft px-3.5 py-2 text-[0.87em] font-bold text-accent">
          {block.title}
        </p>
      )}
      <ol className="divide-y divide-[color:var(--border)]">
        {block.items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex gap-3 px-3.5 py-2.5">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sunken text-[0.74em] font-bold tabular-nums">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.87em] font-semibold">{item.label}</span>
              {item.detail && (
                <span className="block text-[0.87em] leading-relaxed text-muted">{item.detail}</span>
              )}
            </span>
          </li>
        ))}
      </ol>
      {block.note && (
        <p className="border-t border-line px-3.5 py-2 text-[0.8em] leading-relaxed text-muted">{block.note}</p>
      )}
    </div>
  );
}

/** 強度が上がるほど色が濃くなるようにして、表を読まずとも順序が伝わるようにする。 */
const ZONE_TONE: Record<string, string> = {
  Z1: 'bg-good-soft text-good',
  Z2: 'bg-good-soft text-good',
  Z3: 'bg-accent-soft text-accent',
  Z4: 'bg-accent text-[var(--accent-fg)]',
  Z5: 'bg-warn text-[var(--accent-fg)]',
};

function ZonesCard({ block }: { block: ZonesBlock }) {
  return (
    <div className="my-2 overflow-hidden rounded-[14px] border border-line bg-bg">
      {block.basis && (
        <p className="border-b border-line px-3.5 py-2 text-[0.8em] text-muted">{block.basis}</p>
      )}
      <ul className="divide-y divide-[color:var(--border)]">
        {block.rows.map((row) => (
          <li key={row.zone} className="flex items-center gap-3 px-3.5 py-2.5">
            <span
              className={`flex h-7 w-8 shrink-0 items-center justify-center rounded-md text-[0.74em] font-bold ${
                ZONE_TONE[row.zone.toUpperCase()] ?? 'bg-sunken text-fg'
              }`}
            >
              {row.zone}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.87em] font-semibold">{row.name ?? row.zone}</span>
              {row.note && <span className="block text-[0.8em] leading-relaxed text-muted">{row.note}</span>}
            </span>
            {row.range && <span className="shrink-0 text-[0.87em] font-semibold tabular-nums">{row.range}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 道具の提案。リンクはサーバーが組み立てたものだけを使う。
 * 広告リンクを含む場合は必ずその旨を出す（景品表示法のステマ規制）。
 */
function GearCard({ block, catalog }: { block: GearBlock; catalog: ResolvedGear[] }) {
  const items = block.categories
    .map((id) => catalog.find((entry) => entry.id === id))
    .filter((entry): entry is ResolvedGear => Boolean(entry));

  if (items.length === 0) return null;
  const sponsored = items.some((item) => hasAffiliate(item.links));

  return (
    <div className="my-2 overflow-hidden rounded-[14px] border border-line bg-bg">
      <p className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2">
        <span className="text-[0.87em] font-bold">検討したい道具</span>
        <span className="shrink-0 rounded bg-sunken px-1.5 py-0.5 text-[0.68em] text-muted">
          {sponsored ? 'PR・広告リンクを含みます' : '検索リンク'}
        </span>
      </p>

      {block.note && <p className="px-3.5 pt-2.5 text-[0.87em] leading-relaxed">{block.note}</p>}

      <ul className="divide-y divide-[color:var(--border)]">
        {items.map((item) => (
          <li key={item.id} className="px-3.5 py-3">
            <p className="text-[0.87em] font-semibold">{item.title}</p>
            <p className="mt-0.5 text-[0.8em] leading-relaxed text-muted">{item.why}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {item.links.map((link) => (
                <a
                  key={link.shop}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer sponsored"
                  className="rounded-full border border-line px-3 py-1.5 text-[0.8em] font-medium text-accent"
                >
                  {link.shop}で探す
                </a>
              ))}
            </div>
          </li>
        ))}
      </ul>

      <p className="border-t border-line px-3.5 py-2 text-[0.74em] leading-relaxed text-muted">
        商品はモールの検索結果です。実際の仕様と価格は、購入前に必ずご確認ください。
      </p>
    </div>
  );
}

/**
 * 説明図。
 * 知らない id が来ても画面を壊さず、黙って何も出さない。
 * 存在しない絵の枠だけが残る方が、読む人を混乱させる。
 */
function FigureCard({ block }: { block: FigureBlock }) {
  const figure = findFigure(block.id);
  const art = figureArt(block.id);
  if (!figure || !art) return null;

  return (
    <figure className="my-3 overflow-hidden rounded-[14px] border border-line bg-bg">
      <figcaption className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2">
        <span className="text-[0.87em] font-bold">{figure.title}</span>
        <span className="shrink-0 rounded bg-sunken px-1.5 py-0.5 text-[0.68em] text-muted">
          {FIGURE_CATEGORY_LABEL[figure.category]}
        </span>
      </figcaption>

      <div className="bg-sunken px-3 py-2">
        <svg
          viewBox="0 0 240 160"
          className="mx-auto block h-auto w-full max-w-[280px] text-fg"
          role="img"
          aria-label={`${figure.title}の図`}
        >
          {art}
        </svg>
      </div>

      <p className="px-3.5 pt-2.5 text-[0.8em] leading-relaxed text-muted">{figure.purpose}</p>

      <ol className="mt-1.5 space-y-1.5 px-3.5">
        {figure.steps.map((step, index) => (
          <li key={index} className="flex gap-2.5 text-[0.87em] leading-relaxed">
            <span className="mt-[0.15em] flex h-[1.35em] w-[1.35em] shrink-0 items-center justify-center rounded-full bg-sunken text-[0.76em] font-bold tabular-nums">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <Inline parts={parseInline(step)} />
            </span>
          </li>
        ))}
      </ol>

      <ul className="mt-2.5 space-y-1 border-t border-line px-3.5 py-2.5">
        {figure.cautions.map((caution) => (
          <li key={caution} className="flex gap-2 text-[0.8em] leading-relaxed text-warn">
            <span aria-hidden="true" className="mt-[0.5em] h-1 w-1 shrink-0 rounded-full bg-[color:var(--warn)]" />
            <span className="min-w-0 flex-1">
              <Inline parts={parseInline(caution)} />
            </span>
          </li>
        ))}
      </ul>

      {(figure.dose || block.note) && (
        <p className="border-t border-line px-3.5 py-2 text-[0.8em] leading-relaxed">
          {figure.dose && <span className="font-semibold">{figure.dose}</span>}
          {figure.dose && block.note && <span className="text-muted"> / </span>}
          {block.note && <span className="text-muted">{block.note}</span>}
        </p>
      )}
    </figure>
  );
}

function Block({ block, catalog }: { block: RichBlock; catalog: ResolvedGear[] }) {
  switch (block.type) {
    case 'heading':
      return (
        <p className="mt-3 text-[0.94em] font-bold first:mt-0">
          <Inline parts={block.content} />
        </p>
      );
    case 'bullets':
      return (
        <ul className="my-1.5 space-y-1 pl-1">
          {block.items.map((item, index) => (
            <li key={index} className="flex gap-2">
              <span aria-hidden="true" className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-accent" />
              <span className="min-w-0 flex-1">
                <Inline parts={item} />
              </span>
            </li>
          ))}
        </ul>
      );
    case 'ordered':
      return (
        <ol className="my-1.5 space-y-1">
          {block.items.map((item, index) => (
            <li key={index} className="flex gap-2">
              <span className="shrink-0 font-semibold tabular-nums text-accent">{index + 1}.</span>
              <span className="min-w-0 flex-1">
                <Inline parts={item} />
              </span>
            </li>
          ))}
        </ol>
      );
    case 'menu':
      return <MenuCard block={block} />;
    case 'zones':
      return <ZonesCard block={block} />;
    case 'gear':
      return <GearCard block={block} catalog={catalog} />;
    case 'figure':
      return <FigureCard block={block} />;
    case 'pending':
      return <p className="my-1 text-[0.8em] text-muted">…</p>;
    case 'paragraph':
    default:
      return (
        <p className="whitespace-pre-wrap">
          <Inline parts={block.content} />
        </p>
      );
  }
}

/** コーチの発言を、記号ではなく構造として描く。 */
export default function RichText({ text, gear = [] }: { text: string; gear?: ResolvedGear[] }) {
  // モデルがツール呼び出しを本文に書いてしまった場合、
  // 内部処理用の JSON がランナーの画面に出ないよう、描画の前に取り除く。
  const blocks = parseRichText(stripToolTextForDisplay(text));
  return (
    <div className="space-y-2">
      {blocks.map((block, index) => (
        <Block key={index} block={block} catalog={gear} />
      ))}
    </div>
  );
}
