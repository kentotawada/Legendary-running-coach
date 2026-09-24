import { describe, expect, it } from 'vitest';
import type { Content } from '@google/genai';
import { pruneAttachments, rememberAttachments, stripInlineData } from '../src/lib/store';
import { attachmentCountOf, attachmentGroupOf, imagePlaceholder } from '../src/lib/markers';
import { toDisplayMessages } from '../src/lib/profile';
import { looksLikeImage, validateImages } from '../src/lib/images';
import { dataUrlToFile, reattachName } from '../src/lib/downscale';
import { createDefaultProfile } from '../src/lib/types';
import type { AttachmentGroup } from '../src/lib/types';

const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function withImages(count: number): Content[] {
  return [
    {
      role: 'user',
      parts: [
        ...Array.from({ length: count }, () => ({
          inlineData: { mimeType: 'image/jpeg', data: PIXEL },
        })),
        { text: '今日の練習です' },
      ],
    },
    { role: 'model', parts: [{ text: '読み取りました' }] },
  ];
}

describe('添付のマーカー', () => {
  it('控えの id を埋め込み、取り出せる', () => {
    const marker = imagePlaceholder(4, 'gabc123');
    expect(attachmentGroupOf(marker)).toBe('gabc123');
    expect(attachmentCountOf(marker)).toBe(4);
  });

  it('id の無い古い記録でも、枚数は読める', () => {
    const marker = imagePlaceholder(2);
    expect(attachmentGroupOf(marker)).toBeUndefined();
    expect(attachmentCountOf(marker)).toBe(2);
  });

  it('添付でないテキストからは何も取り出さない', () => {
    expect(attachmentGroupOf('ふつうの発言')).toBeUndefined();
    expect(attachmentCountOf('ふつうの発言')).toBe(0);
  });
});

describe('保存する履歴', () => {
  it('画像の本体は落とし、控えへの手がかりだけを残す', () => {
    const stripped = stripInlineData(withImages(3), 'g001');
    const parts = stripped[0].parts ?? [];
    expect(parts.some((part) => part.inlineData)).toBe(false);
    expect(attachmentGroupOf(parts[0].text as string)).toBe('g001');
    expect(attachmentCountOf(parts[0].text as string)).toBe(3);
    // 本文は消さない。
    expect(parts.some((part) => part.text === '今日の練習です')).toBe(true);
  });

  it('画像の無い発言には手を加えない', () => {
    const history: Content[] = [{ role: 'user', parts: [{ text: 'おはようございます' }] }];
    expect(stripInlineData(history, 'g001')).toEqual(history);
  });
});

describe('過去の添付を開き直せる', () => {
  it('控えが残っていれば、送った時と同じ画像が出る', () => {
    const history = stripInlineData(withImages(2), 'g001');
    const attachments: AttachmentGroup[] = [
      { id: 'g001', images: ['data:image/jpeg;base64,A', 'data:image/jpeg;base64,B'], createdAt: '' },
    ];
    const messages = toDisplayMessages(history, attachments);
    expect(messages[0].imagePreviews).toHaveLength(2);
    expect(messages[0].text).toBe('今日の練習です');
  });

  it('控えが落ちていても、枚数の跡だけは残る', () => {
    const history = stripInlineData(withImages(5), 'g999');
    const messages = toDisplayMessages(history, []);
    expect(messages[0].imagePreviews).toBeUndefined();
    expect(messages[0].attachmentCount).toBe(5);
  });

  it('id の無い古い記録でも画面は壊れない', () => {
    const history = stripInlineData(withImages(1));
    const messages = toDisplayMessages(history, []);
    expect(messages[0].attachmentCount).toBe(1);
  });
});

describe('pruneAttachments', () => {
  const group = (id: string, size: number): AttachmentGroup => ({
    id,
    images: ['x'.repeat(size)],
    createdAt: '',
  });

  it('入るだけ新しい方から残す', () => {
    const kept = pruneAttachments([group('a', 100), group('b', 100), group('c', 100)], 250);
    expect(kept.map((g) => g.id)).toEqual(['b', 'c']);
  });

  it('上限に収まるなら全部残す', () => {
    const kept = pruneAttachments([group('a', 10), group('b', 10)], 1000);
    expect(kept).toHaveLength(2);
  });

  it('1件で上限を超えていても、直前の1件は残す', () => {
    // 最新の添付だけは見られる状態にする。全部消えるのが一番困る。
    const kept = pruneAttachments([group('a', 10), group('big', 9999)], 100);
    expect(kept.map((g) => g.id)).toEqual(['big']);
  });

  it('空でも落ちない', () => {
    expect(pruneAttachments([], 100)).toEqual([]);
  });
});

describe('受け取る添付', () => {
  it('控えも一緒に受け取る', () => {
    const result = validateImages([
      { mimeType: 'image/jpeg', data: PIXEL, thumbnail: 'data:image/jpeg;base64,AAAA' },
    ]);
    expect(result.error).toBeUndefined();
    expect(result.images).toHaveLength(1);
    expect(result.thumbnails).toEqual(['data:image/jpeg;base64,AAAA']);
  });

  it('控えが壊れていても、画像そのものは通す', () => {
    const result = validateImages([
      { mimeType: 'image/jpeg', data: PIXEL, thumbnail: 'http://example.com/a.jpg' },
    ]);
    expect(result.images).toHaveLength(1);
    expect(result.thumbnails).toEqual([]);
  });

  it('控えが無くても受け取る', () => {
    const result = validateImages([{ mimeType: 'image/jpeg', data: PIXEL }]);
    expect(result.images).toHaveLength(1);
    expect(result.thumbnails).toEqual([]);
  });
});

describe('looksLikeImage', () => {
  it('種類で判断する', () => {
    expect(looksLikeImage({ type: 'image/png', name: 'a.png' })).toBe(true);
    expect(looksLikeImage({ type: 'application/pdf', name: 'a.pdf' })).toBe(false);
  });

  it('種類が空でも、名前で拾う（iCloud 経由などで起きる）', () => {
    expect(looksLikeImage({ type: '', name: 'IMG_0001.HEIC' })).toBe(true);
    expect(looksLikeImage({ type: '', name: 'run.jpeg' })).toBe(true);
    expect(looksLikeImage({ type: '', name: 'plan.pdf' })).toBe(false);
  });

  it('手がかりが何も無ければ画像とみなさない', () => {
    expect(looksLikeImage({})).toBe(false);
  });
});

describe('rememberAttachments', () => {
  const base = createDefaultProfile('runner-01', '2026-09-24T00:00:00.000Z');

  it('控えをカルテに残す', () => {
    const next = rememberAttachments(base, 'g001', ['data:image/jpeg;base64,A']);
    expect(next.attachments).toHaveLength(1);
    expect(next.attachments?.[0]).toMatchObject({ id: 'g001', images: ['data:image/jpeg;base64,A'] });
  });

  it('前の控えを消さずに足す', () => {
    const first = rememberAttachments(base, 'g001', ['a']);
    const second = rememberAttachments(first, 'g002', ['b']);
    expect(second.attachments?.map((g) => g.id)).toEqual(['g001', 'g002']);
  });

  it('控えが無ければ何もしない', () => {
    expect(rememberAttachments(base, 'g001', [])).toBe(base);
    expect(rememberAttachments(base, undefined, ['a'])).toBe(base);
  });

  it('カルテの他の項目を壊さない', () => {
    const withGoal = { ...base, displayName: '健太' };
    const next = rememberAttachments(withGoal, 'g001', ['a']);
    expect(next.displayName).toBe('健太');
  });
});

describe('dataUrlToFile', () => {
  it('表示用の画像を、もう一度送れるファイルに戻す', async () => {
    const dataUrl = `data:image/png;base64,${PIXEL}`;
    const file = dataUrlToFile(dataUrl, '再添付-1.png');
    expect(file).not.toBeNull();
    expect(file!.type).toBe('image/png');
    expect(file!.name).toBe('再添付-1.png');
    // 中身が保たれていること。名前だけ合っていても意味がない。
    expect(file!.size).toBe(Buffer.from(PIXEL, 'base64').length);
  });

  it('壊れた値では null を返し、例外を投げない', () => {
    expect(dataUrlToFile('https://example.com/a.png', 'a.png')).toBeNull();
    expect(dataUrlToFile('data:image/png;base64,@@@', 'a.png')).toBeNull();
    expect(dataUrlToFile('', 'a.png')).toBeNull();
  });

  it('名前は形式に合わせて付ける', () => {
    expect(reattachName(0, 'data:image/png;base64,x')).toBe('再添付-1.png');
    expect(reattachName(2, 'data:image/jpeg;base64,x')).toBe('再添付-3.jpg');
  });
});
