import { describe, expect, it } from 'vitest';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  SHARE_FILE_NAME,
  shareCardContent,
  splitTokens,
  wrapText,
} from '@/lib/share-card';
import type { RunComparison } from '@/lib/compare';

/**
 * 「過去の自分と比べて」を1枚の画像にする層。
 *
 * **ここは、外に出ていく唯一の画面。** だから守るのは2つ。
 * 本人を特定できるものを入れないことと、画面に出している言葉と食い違わないこと。
 *
 * 絵を描く部分は canvas が要るのでここでは試せない。
 * 中身の組み立てと折り返しだけを、確かめられる形に分けてある。
 */

const better: RunComparison = {
  nowKm: 20,
  nowPaceSec: 330,
  nowHr: 148,
  pastPaceSec: 342,
  pastHr: 152,
  samples: 3,
  fromDaysAgo: 90,
  toDaysAgo: 60,
  paceDeltaSec: -12,
  hrDelta: -4,
  efficiencyPercent: 6.4,
  verdict: 'better',
};

describe('画像に載せる中身', () => {
  it('心拍と効率を、差つきで並べる', () => {
    const content = shareCardContent(better);

    expect(content.stats).toEqual([
      { label: '平均心拍', value: '152 → 148', delta: '-4' },
      { label: '同じ心拍で進める量', value: '+6.4%' },
    ]);
    expect(content.highlight).toBe(true);
  });

  /**
   * ペースは数字で並べず、棒にする。
   * **長さの違いは、読まなくても分かる。** 貼られた画像は、たいてい読まれずに見られる。
   */
  it('ペースは棒で見せる。短いほうが速い', () => {
    const bars = shareCardContent(better).bars!;

    expect(bars.rows.map((row) => row.text)).toEqual(['5:42', '5:30']);
    // 長さは1kmにかかった時間に比例する。今日のほうが短い。
    expect(bars.rows[1].ratio).toBeLessThan(bars.rows[0].ratio);
    expect(bars.rows[1].fast).toBe(true);
    expect(bars.rows[0].fast).toBe(false);
    expect(bars.summary).toBe('1kmあたり 12秒 速くなりました');
  });

  it('心拍が無ければ、棒だけになる', () => {
    const noHr: RunComparison = {
      ...better,
      nowHr: undefined,
      pastHr: undefined,
      hrDelta: undefined,
      efficiencyPercent: undefined,
    };
    const content = shareCardContent(noHr);
    expect(content.stats).toEqual([]);
    expect(content.bars?.rows).toHaveLength(2);
  });

  it('落ちている時も、同じ形で作る', () => {
    const worse: RunComparison = {
      ...better,
      nowPaceSec: 354,
      nowHr: 158,
      paceDeltaSec: 12,
      hrDelta: 6,
      efficiencyPercent: -7.1,
      verdict: 'harder',
    };
    const content = shareCardContent(worse);

    expect(content.bars?.summary).toBe('1kmあたり 12秒 かかっています');
    expect(content.bars?.rows[1].fast).toBe(false);
    expect(content.stats[1].value).toBe('-7.1%');
    // 色を変えるのは良くなった時だけ。中身を隠したり省いたりはしない。
    expect(content.highlight).toBe(false);
    expect(content.title).toBe('前より、同じ距離がきつくなっています');
  });

  /**
   * **画面に出している言葉と、同じものを使う。**
   * 共有した画像にだけ調子のいいことが書いてあると、実物を開いた時に食い違う。
   */
  it('画面と同じ言葉を載せる', () => {
    const content = shareCardContent(better);
    expect(content.title).toBe('同じ心拍で、前より速く走れています');
    expect(content.detail).toContain('同じくらいの距離（20km前後）');
    expect(content.detail).toContain('3本の平均');
  });

  /** **本人を特定できるものを入れない。** 名前も日付も、ここには来させない。 */
  it('名前も日付も入れない', () => {
    const content = shareCardContent(better);
    const all = `${content.label}${content.title}${content.detail}${content.note}${content.brand}${content.bars?.caption ?? ''}`;
    expect(all).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(content.note).toBe('走った記録を、過去の自分と比べています');
    expect(SHARE_FILE_NAME).not.toMatch(/\d/);
  });

  it('縦長（4:5）で書き出す', () => {
    expect(CARD_WIDTH).toBe(1080);
    expect(CARD_HEIGHT).toBe(1350);
    expect(CARD_HEIGHT / CARD_WIDTH).toBeCloseTo(1.25, 5);
  });
});

describe('文字の折り返し', () => {
  /** 1文字1幅として測る、単純な物差し。 */
  const measure: (width: number) => (text: string) => number = () => (text) => [...text].length;

  it('日本語は文字で折り返す', () => {
    const lines = wrapText('同じくらいの距離を走っています', 7, measure(7));
    expect(lines).toEqual(['同じくらいの距', '離を走っていま', 'す']);
  });

  /** **数字が行をまたぐと、数字そのものを疑われる。** */
  it('ペースや割合は、途中で切らない', () => {
    expect(splitTokens('今日は5:30/kmでした')).toEqual([
      '今', '日', 'は', '5:30/km', 'で', 'し', 'た',
    ]);
    expect(splitTokens('+6.4%です')).toEqual(['+6.4%', 'で', 'す']);

    const lines = wrapText('ペースは5:42/kmでした', 8, measure(8));
    for (const line of lines) {
      // 「5:42/km」が2行に割れていないこと。
      expect(line.includes('5:42') === line.includes('/km')).toBe(true);
    }
  });

  it('句点だけが次の行の頭に落ちない', () => {
    const lines = wrapText('速くなった。', 5, measure(5));
    expect(lines[0]).toBe('速くなった。');
    expect(lines).toHaveLength(1);
  });

  it('開き括弧は行末に残さない', () => {
    const lines = wrapText('距離（20km前後）', 4, measure(4));
    expect(lines[0]).toBe('距離');
    expect(lines[1].startsWith('（')).toBe(true);
  });

  it('改行はそのまま行を分ける', () => {
    expect(wrapText('前半\n後半', 100, measure(100))).toEqual(['前半', '後半']);
  });

  it('空の文でも落ちない', () => {
    expect(wrapText('', 100, measure(100))).toEqual(['']);
  });
});
