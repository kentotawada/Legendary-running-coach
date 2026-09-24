import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FIGURE_VIEWBOX, figureArt } from '@/components/FigureArt';
import { FIGURES } from '@/lib/figures';

/**
 * 図の中の文字が、枠からはみ出していないことを機械で確かめる。
 *
 * 目で見て直したつもりでも、**文字は1語足しただけで枠を越える。**
 * 越えた分は画面で切れ、そこだけ読めない図になる。
 * 目視に頼らず、ここで止める。
 */

const [, , WIDTH, HEIGHT] = FIGURE_VIEWBOX.split(' ').map(Number);

/** 全角はおよそ font-size ぶん、半角はその半分強の幅を取る。 */
function textWidth(text: string, fontSize: number): number {
  return [...text].reduce(
    (sum, char) => sum + (char.charCodeAt(0) > 0x2e80 ? fontSize : fontSize * 0.58),
    0,
  );
}

interface Placed {
  text: string;
  from: number;
  to: number;
  y: number;
}

function textsOf(markup: string): Placed[] {
  const placed: Placed[] = [];
  const pattern = /<text([^>]*)>([^<]*)<\/text>/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(markup)) !== null) {
    const attributes = match[1];
    const text = match[2];
    const x = Number(/\sx="([-\d.]+)"/.exec(attributes)?.[1] ?? '0');
    const y = Number(/\sy="([-\d.]+)"/.exec(attributes)?.[1] ?? '0');
    const size = Number(/font-size="([\d.]+)"/.exec(attributes)?.[1] ?? '12');
    const anchor = /text-anchor="(\w+)"/.exec(attributes)?.[1] ?? 'start';
    const width = textWidth(text, size);

    const from = anchor === 'end' ? x - width : anchor === 'middle' ? x - width / 2 : x;
    placed.push({ text, from, to: from + width, y });
  }
  return placed;
}

describe('説明図の文字', () => {
  for (const figure of FIGURES) {
    it(`${figure.title} の文字が枠に収まっている`, () => {
      const art = figureArt(figure.id);
      expect(art).not.toBeNull();

      const markup = renderToStaticMarkup(<svg viewBox={FIGURE_VIEWBOX}>{art}</svg>);
      const texts = textsOf(markup);

      for (const placed of texts) {
        expect(placed.from, `「${placed.text}」が左にはみ出している`).toBeGreaterThanOrEqual(0);
        expect(placed.to, `「${placed.text}」が右にはみ出している`).toBeLessThanOrEqual(WIDTH);
        expect(placed.y, `「${placed.text}」が下にはみ出している`).toBeLessThanOrEqual(HEIGHT - 2);
        expect(placed.y, `「${placed.text}」が上にはみ出している`).toBeGreaterThanOrEqual(10);
      }
    });
  }

  for (const figure of FIGURES) {
    it(`${figure.title} の文字どうしが重なっていない`, () => {
      const markup = renderToStaticMarkup(<svg viewBox={FIGURE_VIEWBOX}>{figureArt(figure.id)}</svg>);
      const texts = textsOf(markup);

      for (let a = 0; a < texts.length; a += 1) {
        for (let b = a + 1; b < texts.length; b += 1) {
          const one = texts[a];
          const other = texts[b];
          // 行が離れていれば、横が重なっていても読める。
          const sameLine = Math.abs(one.y - other.y) < 13;
          const overlaps = one.from < other.to && other.from < one.to;
          expect(
            sameLine && overlaps,
            `「${one.text}」と「${other.text}」が重なっている`,
          ).toBe(false);
        }
      }
    });
  }

  it('図には、絵だけでなく言葉が入っている（絵と目が合った瞬間に分かるように）', () => {
    for (const figure of FIGURES) {
      const markup = renderToStaticMarkup(<svg>{figureArt(figure.id)}</svg>);
      expect(textsOf(markup).length, figure.title).toBeGreaterThan(0);
    }
  });

  it('知らない id には何も描かない', () => {
    expect(figureArt('unknown-figure')).toBeNull();
  });
});
