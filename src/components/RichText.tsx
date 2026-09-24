import { useEffect, useState } from 'react';
import type {
  ChecklistBlock,
  FigureBlock,
  GearBlock,
  InlineText,
  MenuBlock,
  ProductBlock,
  RichBlock,
  ZonesBlock,
} from '@/lib/richtext';
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

function yen(price: number): string {
  return `¥${Math.round(price).toLocaleString('ja-JP')}`;
}

function reviewOf(item: ProductBlock['items'][number]): string | null {
  if (!item.reviewCount || item.reviewCount <= 0) return null;
  const average = item.reviewAverage !== undefined ? item.reviewAverage.toFixed(1) : '-';
  return `★${average}（${item.reviewCount}件）`;
}

/**
 * 実際の商品の候補。
 *
 * 名前・価格・リンクはモールから来た値をそのまま出す。
 * 「なぜこの人にこれなのか」だけがコーチの言葉で、そこを他と見分けられるように色を変えている。
 * 値段は動くので、いつ見た値なのかを必ず添える。
 */
function ProductCard({ block }: { block: ProductBlock }) {
  const sponsored = block.items.some((item) => item.affiliate);

  return (
    <div className="my-2 overflow-hidden rounded-[14px] border border-line bg-bg">
      <p className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2">
        <span className="text-[0.87em] font-bold">あなたに合わせた候補</span>
        <span className="shrink-0 rounded bg-sunken px-1.5 py-0.5 text-[0.68em] text-muted">
          {sponsored ? 'PR・広告リンクを含みます' : '商品リンク'}
        </span>
      </p>

      {block.note && <p className="px-3.5 pt-2.5 text-[0.87em] leading-relaxed">{block.note}</p>}

      {block.spec && block.spec.length > 0 && (
        <div className="mx-3.5 mt-2.5 rounded-[10px] bg-sunken px-3 py-2">
          <p className="text-[0.72em] font-semibold text-muted">この条件で選んでいます</p>
          <ul className="mt-1 space-y-0.5">
            {block.spec.map((line, index) => (
              <li key={index} className="flex gap-1.5 text-[0.78em] leading-relaxed text-muted">
                <span aria-hidden="true" className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-accent" />
                <span className="min-w-0 flex-1">{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="mt-1 divide-y divide-[color:var(--border)]">
        {block.items.map((item) => {
          const review = reviewOf(item);
          return (
            <li key={item.url} className="px-3.5 py-3">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer sponsored"
                className="flex gap-3 transition active:opacity-70"
              >
                {item.image && (
                  // モール側の画像をそのまま出すだけなので next/image は使わない
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.image}
                    alt=""
                    loading="lazy"
                    className="h-16 w-16 shrink-0 rounded-[10px] border border-line bg-sunken object-contain"
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 block text-[0.84em] font-semibold leading-snug">{item.name}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.76em] text-muted">
                    {item.price !== undefined && (
                      <span className="font-semibold tabular-nums text-fg">{yen(item.price)}</span>
                    )}
                    {review && <span>{review}</span>}
                    {item.shop && <span className="max-w-[9em] truncate">{item.shop}</span>}
                  </span>
                </span>
              </a>
              {item.why && (
                <p className="mt-2 rounded-[10px] bg-accent-soft px-3 py-2 text-[0.8em] leading-relaxed text-accent">
                  {item.why}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {block.skipIf && (
        <p className="border-t border-line px-3.5 py-2 text-[0.78em] leading-relaxed text-muted">
          <span className="font-semibold">買わなくていい場合:</span> {block.skipIf}
        </p>
      )}

      <p className="border-t border-line px-3.5 py-2 text-[0.74em] leading-relaxed text-muted">
        価格とレビューは{block.asOf ? `${block.asOf} 時点` : '取得した時点'}のものです。
        在庫・サイズ・仕様は、購入前に必ずご確認ください。
      </p>
    </div>
  );
}

/** チェックの状態は、その端末にだけ残す。サーバーへは送らない。 */
const CHECKLIST_PREFIX = 'coach.checklist:';

function loadChecked(key: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CHECKLIST_PREFIX + key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    // プライベートブラウズなどで読めないことがある。空で始めればよい。
    return [];
  }
}

function saveChecked(key: string, checked: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CHECKLIST_PREFIX + key, JSON.stringify(checked));
  } catch {
    // 保存できなくても、その場の表示は変わっている。黙って諦める。
  }
}

/**
 * 本番の持ち物と段取り。
 *
 * 数字（ジェルの本数、シューズの走行距離、入りのペース）はカルテからの計算結果で、
 * モデルが書いたものではない。
 * チェックした状態はこの端末に残す。前日の夜に開いて、当日の朝にまた開くものなので。
 */
function ChecklistCard({ block }: { block: ChecklistBlock }) {
  const key = block.key ?? block.race;
  const [checked, setChecked] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  // 端末に残した状態は、描かれた後に当てる（サーバー側の描画と食い違わせないため）。
  useEffect(() => {
    setChecked(loadChecked(key));
    setReady(true);
  }, [key]);

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id];
      saveChecked(key, next);
      return next;
    });
  };

  const total = block.sections.reduce((sum, section) => sum + section.items.length, 0);
  const done = ready ? checked.length : 0;

  return (
    <div className="my-2 overflow-hidden rounded-[14px] border border-line bg-bg">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2">
        <div className="min-w-0">
          <p className="truncate text-[0.87em] font-bold">{block.race}の持ち物と段取り</p>
          {block.date && <p className="text-[0.72em] text-muted">{block.date}</p>}
        </div>
        <span className="shrink-0 rounded bg-sunken px-2 py-0.5 text-[0.72em] font-semibold text-muted tabular-nums">
          {block.daysLeft !== undefined
            ? block.daysLeft === 0
              ? '当日'
              : `あと${block.daysLeft}日`
            : `${done}/${total}`}
        </span>
      </div>

      {block.sections.map((section) => (
        <div key={section.title} className="border-b border-line last:border-b-0">
          <p className="px-3.5 pt-2.5 text-[0.76em] font-semibold text-muted">{section.title}</p>
          <ul className="px-1.5 pb-2 pt-1">
            {section.items.map((item) => {
              const id = `${section.title}/${item.label}`;
              const isChecked = checked.includes(id);
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => toggle(id)}
                    aria-pressed={isChecked}
                    className="flex w-full items-start gap-2.5 rounded-[10px] px-2 py-1.5 text-left transition active:bg-sunken"
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-[0.15em] flex h-[1.15em] w-[1.15em] shrink-0 items-center justify-center rounded-[5px] border text-[0.7em] font-bold ${
                        isChecked
                          ? 'border-[color:var(--accent)] bg-accent text-[var(--accent-fg)]'
                          : 'border-line text-transparent'
                      }`}
                    >
                      ✓
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block text-[0.84em] font-medium leading-snug ${
                          isChecked ? 'text-muted line-through' : ''
                        }`}
                      >
                        {item.label}
                      </span>
                      {item.detail && (
                        <span className="mt-0.5 block text-[0.76em] leading-relaxed text-muted">
                          {item.detail}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <p className="border-t border-line px-3.5 py-2 text-[0.74em] leading-relaxed text-muted">
        チェックはこの端末にだけ残ります（{done}/{total}）。当日の朝、もう一度開いてください。
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
    case 'product':
      return <ProductCard block={block} />;
    case 'checklist':
      return <ChecklistCard block={block} />;
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
