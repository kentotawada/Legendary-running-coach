import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/health/route';

/**
 * 足りない設定の名前を、読める形で返す。
 *
 * **読むために出しているものが読めなければ、出していないのと同じ。**
 * JSON は規格上いつも UTF-8 なので文字コードを省いてもよいことになっているが、
 * 省くと、ブラウザがこれを「ダウンロードしたファイル」として開いた時に推測する。
 * iOS Safari は日本語を別の文字コードとして読み、名前が読めない文字の列になった。
 */
describe('設定の状態を返す口', () => {
  it('文字コードを明示している', async () => {
    const response = await GET();
    expect(response.headers.get('content-type')).toContain('charset=utf-8');
  });

  it('日本語が、そのまま読める形で返る', async () => {
    const body = (await (await GET()).json()) as { pending: { label: string }[] };
    for (const item of body.pending) {
      // 化けていれば、置換文字や記号の羅列になる。
      expect(item.label).not.toContain('�');
      expect(item.label).toMatch(/[ぁ-んァ-ヶ一-龠]/);
    }
  });

  it('毎回その場で作る（古い状態を返さない）', async () => {
    expect((await GET()).headers.get('cache-control')).toContain('no-store');
  });
});
