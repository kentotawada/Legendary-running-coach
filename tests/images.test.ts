import { describe, expect, it } from 'vitest';
import { MAX_IMAGES, MAX_TOTAL_BYTES, base64Bytes, validateImages } from '@/lib/images';
import { budgetForCount } from '@/lib/downscale';
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
    const result = validateImages([{ mimeType: 'application/pdf', data: 'AAAA' }]);
    expect(result.images).toEqual([]);
    expect(result.error).toContain('対応していない');
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
