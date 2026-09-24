import { describe, expect, it } from 'vitest';
import { FIGURES, figureDoctrine, findFigure } from '../src/lib/figures';
import { figureArt } from '../src/components/FigureArt';
import { parseRichText } from '../src/lib/richtext';

describe('説明図', () => {
  it('id が重複していない', () => {
    const ids = FIGURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('すべての図に絵がある。片方だけ足すと、カードが黙って消える', () => {
    for (const figure of FIGURES) {
      expect(figureArt(figure.id), figure.id).not.toBeNull();
    }
  });

  it('絵だけあって説明が無い、という状態を作らない', () => {
    for (const figure of FIGURES) {
      expect(figure.title.length, figure.id).toBeGreaterThanOrEqual(3);
      expect(figure.when.length, figure.id).toBeGreaterThan(5);
      expect(figure.purpose.length, figure.id).toBeGreaterThan(15);
      // 手順が2つ以下の図は、文章で足りている。図にする意味がない。
      expect(figure.steps.length, figure.id).toBeGreaterThanOrEqual(3);
      // 体を動かす説明に、危険の但し書きが無いのは許さない。
      expect(figure.cautions.length, figure.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('ストレッチと補強には、回数や時間の目安を付ける', () => {
    for (const figure of FIGURES.filter((f) => f.category !== 'form')) {
      expect(figure.dose, figure.id).toBeTruthy();
    }
  });

  it('知らない id では、絵も説明も返さない（枠だけ残さない）', () => {
    expect(figureArt('stretch-unknown')).toBeNull();
    expect(findFigure('stretch-unknown')).toBeUndefined();
    expect(findFigure(undefined)).toBeUndefined();
    expect(findFigure('')).toBeUndefined();
  });

  it('プロンプトの一覧に、使える図が全部載っている', () => {
    const doctrine = figureDoctrine();
    for (const figure of FIGURES) {
      expect(doctrine, figure.id).toContain(figure.id);
      expect(doctrine).toContain(figure.title);
    }
    // 存在しない id を書かせないことを明示する。
    expect(doctrine).toContain('一覧にあるものだけ');
  });

  it('走り方の図がある。ストレッチだけでは、走りの説明に使えない', () => {
    const categories = new Set(FIGURES.map((f) => f.category));
    expect(categories.has('stretch')).toBe(true);
    expect(categories.has('form')).toBe(true);
    expect(categories.has('strength')).toBe(true);
  });
});

describe('figure ブロックの解釈', () => {
  it('id を取り出す', () => {
    const blocks = parseRichText('まずここから。\n```figure\n{"id":"stretch-calf"}\n```\n続けましょう。');
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'figure', 'paragraph']);
    expect(blocks[1]).toMatchObject({ type: 'figure', id: 'stretch-calf' });
  });

  it('その人向けの一言を添えられる', () => {
    const blocks = parseRichText('```figure\n{"id":"stretch-calf","note":"右だけ念入りに"}\n```');
    expect(blocks[0]).toMatchObject({ type: 'figure', note: '右だけ念入りに' });
  });

  it('生成の途中は中身を出さない', () => {
    const blocks = parseRichText('```figure\n{"id":"stretch-calf"');
    expect(blocks.at(-1)?.type).toBe('pending');
  });

  it('壊れた JSON は本文として扱う。生の JSON を画面に出さない', () => {
    const blocks = parseRichText('```figure\n{"id":\n```');
    expect(blocks.every((b) => b.type !== 'figure')).toBe(true);
  });

  it('id が無いブロックは図にしない', () => {
    const blocks = parseRichText('```figure\n{"note":"膝に注意"}\n```');
    expect(blocks.every((b) => b.type !== 'figure')).toBe(true);
  });
});
