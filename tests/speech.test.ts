import { describe, expect, it } from 'vitest';
import { speakableNumbers, toSpokenText } from '../src/lib/speech';
import {
  DEFAULT_FONT_SIZE,
  FONT_SIZES,
  MIN_INPUT_FONT_PX,
  findFontSize,
  inputFontSize,
} from '../src/lib/display';

describe('speakableNumbers', () => {
  it('ペースを耳で分かる形に直す', () => {
    expect(speakableNumbers('イージーは 5:30/km です')).toContain('5分30秒パーキロ');
    expect(speakableNumbers('4:15 /km')).toContain('4分15秒パーキロ');
  });

  it('目標タイムは時間・分・秒として読む', () => {
    expect(speakableNumbers('2:59:59 を狙う')).toContain('2時間59分59秒');
  });

  it('練習時間の 20:00 は分と秒として読む', () => {
    expect(speakableNumbers('閾値走 20:00')).toContain('20分00秒');
  });

  it('単位を日本語にする', () => {
    expect(speakableNumbers('20km 走る')).toContain('20キロ');
    expect(speakableNumbers('心拍 150bpm')).toContain('150拍');
    expect(speakableNumbers('体重 58kg')).toContain('58キロ');
  });
});

describe('toSpokenText', () => {
  it('太字の記号は読み上げない', () => {
    const spoken = toSpokenText('**8割はイージー**で走ってください');
    expect(spoken).not.toContain('*');
    expect(spoken).toContain('8割はイージー');
  });

  it('箇条書きは文として読める形になる', () => {
    const spoken = toSpokenText('- 月曜は休養\n- 火曜は閾値走');
    expect(spoken).toContain('月曜は休養。');
    expect(spoken).toContain('火曜は閾値走。');
    expect(spoken).not.toContain('- ');
  });

  it('メニューのカードは JSON ではなく中身を読む', () => {
    const spoken = toSpokenText(
      '今日はこれで。\n```menu\n{"title":"閾値走","items":[{"label":"ウォームアップ","detail":"15分"}],"note":"重ければ短縮可"}\n```',
    );
    expect(spoken).toContain('閾値走');
    expect(spoken).toContain('ウォームアップ、15分');
    expect(spoken).toContain('重ければ短縮可');
    expect(spoken).not.toContain('{');
    expect(spoken).not.toContain('items');
  });

  it('心拍ゾーンのカードも中身を読む', () => {
    const spoken = toSpokenText(
      '```zones\n{"basis":"最大心拍 190 から算出","rows":[{"zone":"Z2","name":"イージー","range":"124〜142"}]}\n```',
    );
    expect(spoken).toContain('最大心拍 190 から算出');
    expect(spoken).toContain('イージー、124〜142');
    expect(spoken).not.toContain('rows');
  });

  it('道具カードはリンクを読み上げず、画面を見るよう促す', () => {
    const spoken = toSpokenText('```gear\n{"categories":["shoes"],"note":"シューズを見直しましょう"}\n```');
    expect(spoken).toContain('シューズを見直しましょう');
    expect(spoken).toContain('画面');
    expect(spoken).not.toContain('categories');
  });

  it('商品カードは、値段ではなく選んだ理由を読む', () => {
    const spoken = toSpokenText(
      '```product\n{"items":[{"name":"シューズ X","url":"https://example.com/a","price":15400,"why":"週70kmを2足で回すため"}],"skipIf":"500km以下なら不要"}\n```',
    );
    expect(spoken).toContain('週70キロを2足で回すため');
    expect(spoken).toContain('画面');
    expect(spoken).not.toContain('15400');
    expect(spoken).not.toContain('https');
  });

  it('本文に紛れ込んだツール呼び出しは読み上げない', () => {
    const spoken = toSpokenText('了解です。\nset_today_plan {"title":"閾値走","steps":["20分"]}');
    expect(spoken).not.toContain('set_today_plan');
    expect(spoken).toContain('了解です');
  });

  it('絵文字は読み上げない', () => {
    expect(toSpokenText('🎉 よくやりました')).not.toContain('🎉');
  });

  it('空の返答からは何も作らない', () => {
    expect(toSpokenText('')).toBe('');
    expect(toSpokenText('   ')).toBe('');
  });
});

describe('文字サイズ', () => {
  it('今までの大きさが真ん中で、小さくも大きくもできる', () => {
    const medium = findFontSize(DEFAULT_FONT_SIZE);
    expect(medium.scale).toBe(1);
    expect(FONT_SIZES.some((size) => size.scale < 1)).toBe(true);
    expect(FONT_SIZES.some((size) => size.scale > 1)).toBe(true);
  });

  it('未知の値では今までの大きさに落ちる', () => {
    expect(findFontSize('huge').id).toBe(DEFAULT_FONT_SIZE);
    expect(findFontSize(null).id).toBe(DEFAULT_FONT_SIZE);
  });
});

describe('入力欄の文字の大きさ', () => {
  it('どの設定でも 16px を下回らない（下回ると iOS が勝手に拡大する）', () => {
    for (const size of FONT_SIZES) {
      expect(inputFontSize(size.scale), size.id).toBeGreaterThanOrEqual(MIN_INPUT_FONT_PX);
    }
  });

  it('「大」では本文に合わせて大きくなる', () => {
    const large = FONT_SIZES.find((s) => s.id === 'large')!;
    expect(inputFontSize(large.scale)).toBeGreaterThan(MIN_INPUT_FONT_PX);
  });

  it('極端に小さい倍率でも下限で止まる', () => {
    expect(inputFontSize(0.1)).toBe(MIN_INPUT_FONT_PX);
    expect(inputFontSize(0)).toBe(MIN_INPUT_FONT_PX);
  });
});
