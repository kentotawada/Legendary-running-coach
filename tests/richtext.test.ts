import { describe, expect, it } from 'vitest';
import { parseInline, parseRichText, type MenuBlock, type ZonesBlock } from '@/lib/richtext';

const plain = (blocks: ReturnType<typeof parseRichText>) =>
  blocks
    .map((b) =>
      b.type === 'paragraph' || b.type === 'heading'
        ? b.content.map((c) => c.value).join('')
        : b.type === 'bullets' || b.type === 'ordered'
          ? b.items.map((item) => item.map((c) => c.value).join('')).join(' / ')
          : b.type,
    )
    .join('\n');

describe('parseInline', () => {
  it('アスタリスクを記号として残さず、太字として取り出す', () => {
    const parts = parseInline('今日は**閾値走**です');

    expect(parts).toEqual([
      { type: 'text', value: '今日は' },
      { type: 'bold', value: '閾値走' },
      { type: 'text', value: 'です' },
    ]);
    expect(parts.some((p) => p.value.includes('*'))).toBe(false);
  });

  it('生成途中で閉じていない太字も、記号を見せない', () => {
    const parts = parseInline('結論から言うと、**とても良い練習');

    expect(parts.map((p) => p.value).join('')).toBe('結論から言うと、とても良い練習');
    expect(parts.at(-1)?.type).toBe('bold');
  });

  it('コード記法も記号を残さない', () => {
    expect(parseInline('`4:15/km` を基準に')).toEqual([
      { type: 'code', value: '4:15/km' },
      { type: 'text', value: ' を基準に' },
    ]);
  });
});

describe('parseRichText', () => {
  it('見出し・箇条書き・段落を構造として取り出す', () => {
    const blocks = parseRichText('## 今日の評価\n\n良い練習でした。\n\n- 心拍は適正\n- ピッチ183\n\n1. 明日は休む\n2. 木曜に閾値');

    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'bullets', 'ordered']);
    expect(plain(blocks)).toContain('心拍は適正 / ピッチ183');
  });

  it('記号が本文に残らない', () => {
    const blocks = parseRichText('# 見出し\n- **強調**された項目');
    expect(plain(blocks)).not.toMatch(/[#*]/);
  });

  it('メニューの囲みブロックをカードとして取り出す', () => {
    const blocks = parseRichText(
      '今日はこれで。\n```menu\n{"title":"閾値走","items":[{"label":"W-up","detail":"15分"},{"label":"T走","detail":"20分 4:04/km"}],"note":"無理なら短縮可"}\n```\n頑張りましょう。',
    );

    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'menu', 'paragraph']);
    const menu = blocks[1] as MenuBlock;
    expect(menu.title).toBe('閾値走');
    expect(menu.items).toHaveLength(2);
    expect(menu.items[1].detail).toBe('20分 4:04/km');
  });

  it('心拍ゾーンの囲みブロックを表として取り出す', () => {
    const blocks = parseRichText(
      '```zones\n{"basis":"最大心拍190","rows":[{"zone":"Z2","name":"イージー","range":"124-142"}]}\n```',
    );

    const zones = blocks[0] as ZonesBlock;
    expect(zones.type).toBe('zones');
    expect(zones.basis).toBe('最大心拍190');
    expect(zones.rows[0].name).toBe('イージー');
  });

  it('生成途中の囲みブロックは、JSONを画面に出さない', () => {
    const blocks = parseRichText('結果です。\n```menu\n{"title":"閾値走","items":[{"lab');

    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'pending']);
    expect(JSON.stringify(blocks)).not.toContain('閾値走');
  });

  it('壊れたJSONは、生のまま見せずに本文として扱う', () => {
    const blocks = parseRichText('```menu\nこれはJSONではありません\n```');

    expect(blocks[0].type).toBe('paragraph');
    expect(plain(blocks)).toBe('これはJSONではありません');
  });

  it('普通の文章はそのまま段落になる', () => {
    const blocks = parseRichText('おはようございます。\n今日はよく走れましたね。');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('paragraph');
  });
});
