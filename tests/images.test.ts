import { describe, expect, it } from 'vitest';
import {
  MAX_IMAGES,
  MAX_TOTAL_BYTES,
  base64Bytes,
  looksLikeAttachment,
  validateImages,
} from '@/lib/images';
import { MAX_TILES, budgetForCount, tilesFor } from '@/lib/downscale';
import { stripInlineData } from '@/lib/store';
import { IMAGE_MARKER } from '@/lib/markers';
import { toDisplayMessages } from '@/lib/profile';

const jpeg = (data = 'AAAA') => ({ mimeType: 'image/jpeg', data });

describe('validateImages', () => {
  it('添付が無い場合は空で通す', () => {
    expect(validateImages(undefined).images).toEqual([]);
    expect(validateImages([]).images).toEqual([]);
  });

  it('JPEG / PNG / WebP を受け取る', () => {
    const result = validateImages([jpeg(), { mimeType: 'image/png', data: 'BBBB' }]);
    expect(result.error).toBeUndefined();
    expect(result.images).toHaveLength(2);
  });

  it('data URL の接頭辞が付いていても剥がして受け取る', () => {
    const result = validateImages([{ mimeType: 'image/jpeg', data: 'data:image/jpeg;base64,QUJD' }]);
    expect(result.images[0].data).toBe('QUJD');
  });

  it('対応していない形式は理由を添えて断る', () => {
    const result = validateImages([{ mimeType: 'text/csv', data: 'AAAA' }]);
    expect(result.images).toEqual([]);
    expect(result.error).toContain('対応していない');
  });

  /**
   * iPhone の「フルページ」スクリーンショットは PDF で保存される。
   * 長い画面を1枚で渡せる唯一の道なので、ここで受ける。
   */
  it('PDF を受け取る', () => {
    const result = validateImages([{ mimeType: 'application/pdf', data: 'QUJD' }]);
    expect(result.error).toBeUndefined();
    expect(result.images[0].mimeType).toBe('application/pdf');
  });

  it('枚数の上限を超えたら断る', () => {
    const many = Array.from({ length: MAX_IMAGES + 1 }, () => jpeg());
    expect(validateImages(many).error).toContain(`${MAX_IMAGES}枚まで`);
  });

  it('合計サイズが大きすぎるものは、投げる前に弾く', () => {
    const huge = jpeg('A'.repeat(7 * 1024 * 1024));
    expect(validateImages([huge]).error).toContain('大きすぎます');
  });

  it('壊れた入力でも例外を投げない', () => {
    expect(validateImages('画像').error).toBeTruthy();
    expect(validateImages([null]).error).toBeTruthy();
    expect(validateImages([{ mimeType: 'image/jpeg' }]).error).toBeTruthy();
  });

  it('base64 の実バイト数を数えられる', () => {
    expect(base64Bytes('QUJD')).toBe(3);
    expect(base64Bytes('QUJDRA==')).toBe(4);
  });
});

describe('stripInlineData', () => {
  it('画像の本体は保存せず、添付があった跡だけを残す', () => {
    const stripped = stripInlineData([
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: 'VERYLONGBASE64' } },
          { inlineData: { mimeType: 'image/jpeg', data: 'ANOTHERONE' } },
          { text: 'これ見てください' },
        ],
      },
    ]);

    const serialized = JSON.stringify(stripped);
    expect(serialized).not.toContain('VERYLONGBASE64');
    expect(serialized).not.toContain('ANOTHERONE');
    expect(stripped[0].parts?.[0].text).toContain(IMAGE_MARKER);
    expect(stripped[0].parts?.[0].text).toContain('画像が2枚');
    expect(stripped[0].parts?.[1].text).toBe('これ見てください');
  });

  it('画像を含まない発言には手を触れない', () => {
    const history = [
      { role: 'user', parts: [{ text: 'やあ' }] },
      { role: 'user', parts: [{ functionResponse: { name: 'log_activity', response: { ok: true } } }] },
    ];
    expect(stripInlineData(history)).toEqual(history);
  });

  it('画面では、添付があったことが枚数として見える', () => {
    const stripped = stripInlineData([
      {
        role: 'user',
        parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'X' } }, { text: '今日の練習です' }],
      },
    ]);

    expect(toDisplayMessages(stripped)).toEqual([
      { id: '0', role: 'user', text: '今日の練習です', attachmentCount: 1 },
    ]);
  });
});

describe('枚数に応じた圧縮の割り当て', () => {
  it('10枚まで添付できる', () => {
    expect(MAX_IMAGES).toBe(10);
  });

  it('枚数が増えるほど、1枚に割ける容量が小さくなる', () => {
    expect(budgetForCount(10)).toBeLessThan(budgetForCount(3));
    expect(budgetForCount(3)).toBeLessThan(budgetForCount(1));
  });

  it('上限いっぱいの10枚でも、合計が送信上限を超えない', () => {
    expect(budgetForCount(MAX_IMAGES) * MAX_IMAGES).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
  });

  it('1枚だけの時は、必要以上に劣化させない', () => {
    // 10枚割り当ての数倍の容量を1枚に使える。
    expect(budgetForCount(1)).toBeGreaterThan(budgetForCount(10) * 3);
  });
});

describe('縦に長い画像の切り分け', () => {
  /**
   * スクロールして撮った1枚や、繋ぎ合わせた画像は縦横比が極端になる。
   * 長辺に合わせて縮めると、**横幅が100px台まで潰れて数字が読めなくなる。**
   * 読めない画像を送るのは、送っていないのと同じ。
   */
  it('普通の画面は、切らない', () => {
    expect(tilesFor(1170, 2532)).toHaveLength(1);
    expect(tilesFor(1170, 1170)).toHaveLength(1);
  });

  it('長い画面は、読める形に切り分ける', () => {
    const tiles = tilesFor(1170, 9000);
    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles.length).toBeLessThanOrEqual(MAX_TILES);
    // どの1枚も、横幅に対して極端に縦長にならない
    for (const tile of tiles) expect(tile.height / 1170).toBeLessThan(2.6);
  });

  it('どれだけ長くても、切りすぎない', () => {
    expect(tilesFor(1170, 60_000)).toHaveLength(MAX_TILES);
  });

  /** 境目で数字が切れると、そこだけ読み取れない。少し重ねて切る。 */
  it('切れ目を少し重ねる', () => {
    const tiles = tilesFor(1000, 6000);
    for (let i = 1; i < tiles.length; i += 1) {
      const previousEnd = tiles[i - 1].y + tiles[i - 1].height;
      expect(previousEnd).toBeGreaterThan(tiles[i].y);
    }
  });

  it('全体を覆う（端を落とさない）', () => {
    const tiles = tilesFor(1000, 6000);
    expect(tiles[0].y).toBe(0);
    const last = tiles[tiles.length - 1];
    expect(last.y + last.height).toBe(6000);
  });

  it('大きさが分からない時でも落ちない', () => {
    expect(tilesFor(0, 0)).toHaveLength(1);
  });
});

describe('送れる添付の見分け', () => {
  it('画像と PDF を通す', () => {
    expect(looksLikeAttachment({ type: 'image/png' })).toBe(true);
    expect(looksLikeAttachment({ type: 'application/pdf' })).toBe(true);
    // iCloud 経由などで type が空のことがある。名前で判断する。
    expect(looksLikeAttachment({ type: '', name: 'フルページ.pdf' })).toBe(true);
  });

  it('練習の記録ファイルは、添付として扱わない', () => {
    expect(looksLikeAttachment({ type: '', name: '12345.fit' })).toBe(false);
    expect(looksLikeAttachment({ type: '', name: 'export.zip' })).toBe(false);
  });
});
