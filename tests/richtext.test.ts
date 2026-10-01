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

describe('道具の提案ブロック', () => {
  it('カテゴリidだけを受け取る（URLはモデルに書かせない）', () => {
    const blocks = parseRichText(
      '距離が増えてきましたね。\n```gear\n{"categories":["shoes-daily","scale"],"note":"2足を交互に"}\n```',
    );

    expect(blocks[1].type).toBe('gear');
    const gear = blocks[1] as { categories: string[]; note?: string };
    expect(gear.categories).toEqual(['shoes-daily', 'scale']);
    expect(gear.note).toBe('2足を交互に');
    expect(JSON.stringify(blocks)).not.toContain('http');
  });

  it('カテゴリが無ければ本文として扱う', () => {
    const blocks = parseRichText('```gear\n{"categories":[]}\n```');
    expect(blocks[0].type).toBe('paragraph');
  });
});

describe('商品ブロック', () => {
  const item = {
    name: 'シューズ X',
    url: 'https://hb.afl.rakuten.co.jp/a/',
    price: 15400,
    shop: '店',
    image: 'https://thumbnail.image.rakuten.co.jp/a.jpg?_ex=300x300',
    why: '週70kmを2足で回すため',
    affiliate: true,
    reviewAverage: 4.7,
    reviewCount: 55,
  };

  it('差し替え済みの商品を読み取る', () => {
    const blocks = parseRichText(
      `\`\`\`product\n${JSON.stringify({ items: [item], note: 'まず1足', spec: ['週70km'], skipIf: '500km以下なら不要', asOf: '2026-09-24' })}\n\`\`\``,
    );
    const block = blocks[0] as { type: string; items: { name: string }[]; spec?: string[]; asOf?: string };

    expect(block.type).toBe('product');
    expect(block.items[0].name).toBe('シューズ X');
    expect(block.spec).toEqual(['週70km']);
    expect(block.asOf).toBe('2026-09-24');
  });

  it('http(s) 以外のリンクは出さない', () => {
    const blocks = parseRichText(
      `\`\`\`product\n${JSON.stringify({ items: [{ ...item, url: 'javascript:alert(1)' }] })}\n\`\`\``,
    );
    expect(blocks.every((block) => block.type !== 'product')).toBe(true);
  });

  it('名札のままの状態では、中身の JSON を本文に出さない', () => {
    const blocks = parseRichText('```product\n{"picks":[{"ref":"p1","why":"これ"}]}\n```');
    expect(blocks.every((block) => block.type !== 'product')).toBe(true);
    expect(JSON.stringify(blocks)).not.toContain('ref');
  });
});


/**
 * **空行だけで、箇条書きを切らない。**
 *
 * コーチは番号付きの手順を、読みやすさのために1行あけて書く。
 * そこで切ると2つ目以降がそれぞれ別の箇条書きになり、
 * **全部「1.」から始まってしまう。** 実際にそう出ていた。
 */
describe('番号付きの箇条書き', () => {
  it('間に空行があっても、ひと続きの番号になる', () => {
    const blocks = parseRichText('1. まず\n\n2. つぎに\n\n3. さいごに');
    const lists = blocks.filter((block) => block.type === 'ordered');
    expect(lists).toHaveLength(1);
    expect(lists[0].type === 'ordered' && lists[0].items).toHaveLength(3);
  });

  it('空行が無くても、これまで通り', () => {
    const blocks = parseRichText('1. まず\n2. つぎに\n3. さいごに');
    const lists = blocks.filter((block) => block.type === 'ordered');
    expect(lists).toHaveLength(1);
    expect(lists[0].type === 'ordered' && lists[0].items).toHaveLength(3);
  });

  it('箇条書き（・）でも同じ', () => {
    const blocks = parseRichText('- ひとつ\n\n- ふたつ');
    const lists = blocks.filter((block) => block.type === 'bullets');
    expect(lists).toHaveLength(1);
    expect(lists[0].type === 'bullets' && lists[0].items).toHaveLength(2);
  });

  it('間に文章が入れば、そこで切れる（別の話なので）', () => {
    const blocks = parseRichText('1. まず\n\nここで一度まとめます。\n\n1. あらためて');
    expect(blocks.filter((block) => block.type === 'ordered')).toHaveLength(2);
  });

  it('種類が変われば、そこで切れる', () => {
    const blocks = parseRichText('1. 番号\n\n- 点');
    expect(blocks.filter((block) => block.type === 'ordered')).toHaveLength(1);
    expect(blocks.filter((block) => block.type === 'bullets')).toHaveLength(1);
  });

  /**
   * 実際に出ていた形。項目のあいだに、字下げした段落が挟まる。
   * ここで切ると項目ごとに別の箇条書きになり、全部「1.」になる。
   */
  it('字下げした続きの段落があっても、ひと続きの番号になる', () => {
    const blocks = parseRichText(
      '1. 安定性のあるものを選ぶ:\n\n    厚底の中でも、着地した時に。\n\n' +
        '2. 反発のタイミング:\n\n    ポンと地面から足が離れる感覚。\n\n' +
        '3. サイズは妥協しない:\n\n    足が中で遊ばないように。',
    );
    const lists = blocks.filter((block) => block.type === 'ordered');
    expect(lists).toHaveLength(1);
    expect(lists[0].type === 'ordered' && lists[0].items).toHaveLength(3);
  });

  it('字下げの続きは、その項目の中に入る', () => {
    const blocks = parseRichText('1. みだし\n    つづきの説明');
    const list = blocks.find((block) => block.type === 'ordered');
    expect(list?.type === 'ordered' && list.items).toHaveLength(1);
    const text = JSON.stringify(list);
    expect(text).toContain('みだし');
    expect(text).toContain('つづきの説明');
  });

  it('字下げしていない段落は、これまで通りそこで切る', () => {
    const blocks = parseRichText('1. みだし\nべつの話です。');
    expect(blocks.filter((block) => block.type === 'ordered')).toHaveLength(1);
    expect(blocks.filter((block) => block.type === 'paragraph')).toHaveLength(1);
  });

  it('終わりが空行でも落ちない', () => {
    expect(() => parseRichText('1. まず\n\n')).not.toThrow();
    expect(parseRichText('1. まず\n\n').filter((b) => b.type === 'ordered')).toHaveLength(1);
  });
});
