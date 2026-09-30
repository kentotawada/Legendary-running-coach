import { describe, expect, it } from 'vitest';
import {
  COACH_CHARACTERS,
  COACH_LEVELS,
  COACH_LEVEL_LABEL,
  charactersByLevel,
  characterVoice,
  levelInfo,
  type CoachLevel,
} from '@/lib/characters';

/**
 * コーチの難易度。
 *
 * 入口で8人の顔だけを並べると、いちばん上に出た人の一言で「自分向けか」が
 * 決まってしまう。難易度は、走り始めたい人が「まず数字を見ます」と言う人の
 * 隣で迷わないために置いている。**表示のためだけのもので、指導は変えない。**
 */
describe('コーチの難易度', () => {
  it('4段あり、軽いほうから並んでいる', () => {
    expect(COACH_LEVELS.map((level) => level.id)).toEqual(['easy', 'normal', 'hard', 'oni']);
  });

  it('全員に難易度がついている', () => {
    const known = new Set<string>(COACH_LEVELS.map((level) => level.id));
    for (const character of COACH_CHARACTERS) {
      expect(known.has(character.level), `${character.name} の難易度`).toBe(true);
    }
  });

  it('どの段にも最低1人いる（空の見出しを出さない）', () => {
    for (const level of COACH_LEVELS) {
      const found = COACH_CHARACTERS.filter((character) => character.level === level.id);
      expect(found.length, `${level.label} のコーチ`).toBeGreaterThanOrEqual(1);
    }
  });

  it('いちばん軽い段は、走ったことがない人でも選べる言葉になっている', () => {
    const easy = levelInfo('easy');
    // 「初級者向け」と書くと、自分に札を貼らせることになる。
    expect(easy.label).toBe('かんたん');
    expect(`${easy.demand}${easy.who}`).not.toMatch(/初級|初心者|レベル/);
    // ノルマを出さないことは、ここで約束しておく。phase.habit と同じ立場。
    expect(easy.demand).toMatch(/ノルマ|数字/);
  });

  it('難易度の説明は、抽象語ではなく思い当たる場面で書かれている', () => {
    for (const level of COACH_LEVELS) {
      expect(level.demand.length, `${level.label} の求める量`).toBeGreaterThan(5);
      expect(level.who.length, `${level.label} の対象`).toBeGreaterThan(15);
      // 「上級者向け」だけでは、読んだ人が自分のことだと判断できない。
      expect(level.who).not.toMatch(/^(初級|中級|上級)者?向け。?$/);
    }
  });

  it('色は段ごとに違う（同じ色だと段の切り替わりが見えない）', () => {
    const colors = new Set(COACH_LEVELS.map((level) => level.color));
    expect(colors.size).toBe(COACH_LEVELS.length);
    for (const level of COACH_LEVELS) {
      expect(level.color, `${level.label} の色`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('ラベルの表だけを見ても、一覧と食い違わない', () => {
    for (const level of COACH_LEVELS) {
      expect(COACH_LEVEL_LABEL[level.id]).toBe(level.label);
    }
  });

  describe('charactersByLevel', () => {
    it('全員をちょうど一度ずつ、軽いほうから返す', () => {
      const groups = charactersByLevel();
      const ids = groups.flatMap((group) => group.characters.map((character) => character.id));
      expect(ids.length).toBe(COACH_CHARACTERS.length);
      expect(new Set(ids).size).toBe(COACH_CHARACTERS.length);
      const order = groups.map((group) => group.level.id);
      expect(order).toEqual([...order].sort((a, b) => levelRank(a) - levelRank(b)));
      expect(order[0]).toBe('easy');
    });

    it('各段には、その段のコーチだけが入る', () => {
      for (const group of charactersByLevel()) {
        for (const character of group.characters) {
          expect(character.level).toBe(group.level.id);
        }
      }
    });

    it('誰も居ない段は返さない', () => {
      const onlyEasy = COACH_CHARACTERS.filter((character) => character.level === 'easy');
      const groups = charactersByLevel(onlyEasy);
      expect(groups.map((group) => group.level.id)).toEqual(['easy']);
    });

    it('渡した並びは段の中で保たれる', () => {
      const easy = COACH_CHARACTERS.filter((character) => character.level === 'easy');
      const reversed = [...easy].reverse();
      const groups = charactersByLevel(reversed);
      expect(groups[0]!.characters.map((character) => character.id)).toEqual(
        reversed.map((character) => character.id),
      );
    });
  });

  /**
   * **難易度はプロンプトに渡さない。**
   *
   * 渡すと「かんたん」のコーチが本気の相談を断り、「おに」のコーチが
   * 歩いた日を認めなくなる。走る量を決めるのは、選んだ札ではなく
   * その人の記録と段階（phase）。ここは口調の指示だけを持つ。
   */
  it('口調の指示に難易度は混ざらない', () => {
    for (const character of COACH_CHARACTERS) {
      const voice = characterVoice(character.id, 'ケント');
      for (const level of COACH_LEVELS) {
        expect(voice, `${character.name} の指示に「${level.label}」`).not.toContain(level.label);
        expect(voice).not.toContain(level.demand);
        expect(voice).not.toContain(level.who);
      }
      expect(voice).not.toContain('難易度');
    }
  });

  it('知らない難易度を渡されても落ちない', () => {
    expect(levelInfo('easy').label).toBe('かんたん');
    expect(levelInfo('nope' as CoachLevel).id).toBe('easy');
  });
});

function levelRank(level: CoachLevel): number {
  return COACH_LEVELS.findIndex((item) => item.id === level);
}
