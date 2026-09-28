import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { COACH_CHARACTERS, DEFAULT_CHARACTER_ID, characterVoice, findCharacter } from '@/lib/characters';

describe('コーチのキャラクター', () => {
  it('選べるコーチが揃っていて、それぞれ選ぶ材料を持つ', () => {
    expect(COACH_CHARACTERS.length).toBeGreaterThanOrEqual(4);
    for (const character of COACH_CHARACTERS) {
      // 写真を指すなら、形は揃える。無い人は頭文字で描かれる。
      if (character.photo) expect(character.photo).toMatch(/^\/coaches\/.+\.webp$/);
      expect(character.initial.length).toBeGreaterThan(0);
      expect(character.name).toContain(' ');
      expect(character.reading.length).toBeGreaterThan(0);
      expect(character.title.length).toBeGreaterThan(0);
      expect(character.description.length).toBeGreaterThan(10);
      expect(character.voice.length).toBeGreaterThanOrEqual(3);
      // 「こういう人におすすめ」が無いと、肩書きだけで選ばせることになる。
      expect(character.recommendedFor.length).toBeGreaterThanOrEqual(2);
      expect(character.career.length).toBeGreaterThanOrEqual(2);
      expect(character.strengths.length).toBeGreaterThanOrEqual(2);
      expect(character.sample.length).toBeGreaterThan(20);
    }
  });

  it('顔写真を指しているなら、その画像が実在する', () => {
    // **在りもしないパスを書かない。** 読み込みに失敗してから頭文字に落ちるので、
    // 一瞬だけ空の丸が出る。無いなら最初から指定しない。
    for (const character of COACH_CHARACTERS) {
      if (!character.photo) continue;
      expect(existsSync(`public${character.photo}`), character.name).toBe(true);
    }
  });

  it('顔の下の一言が、紹介文ではなく本人の言葉になっている', () => {
    // **「〜する」で終わる説明文は、人の言葉ではない。**
    // 8人並べた時に、求人票ではなく人が並んでいるように見えるかどうか。
    for (const character of COACH_CHARACTERS) {
      // 2枚並びのカードは1行に約9字。**18字を超えると3行に折れて、
      // その1枚だけ背が高くなる。** 実機で折り返しを見て決めた上限。
      expect(character.tagline.length, character.name).toBeLessThanOrEqual(18);
      expect(character.tagline, character.name).not.toMatch(/(する|示す|決める|喜ぶ|いる)$/);
    }
  });

  it('話し方が、キャラクターごとに書き分けられている', () => {
    // **「優しく」「熱く」では、書く側は何も変えられない。**
    // 一人称・敬称・語尾まで決めて、はじめて別人になる。
    for (const character of COACH_CHARACTERS) {
      expect(character.speech.first.length, character.name).toBeGreaterThan(0);
      // 敬称は呼び捨て（空文字）もありなので、長さは問わない。型としてあることだけ確かめる。
      expect(typeof character.speech.honorific, character.name).toBe('string');
      expect(character.speech.habits.length, character.name).toBeGreaterThanOrEqual(3);
      expect(character.speech.never.length, character.name).toBeGreaterThanOrEqual(2);
      // 褒める時・良くない時・痛みがある時。この3つは全員ぶん要る。
      expect(character.lines.length, character.name).toBe(3);
      for (const line of character.lines) {
        expect(line.say.length, `${character.name}: ${line.when}`).toBeGreaterThan(10);
      }
    }
  });

  it('一人称が全員同じ、ということが起きていない', () => {
    // 全員「私」なら、書き分けたことにならない。
    const firsts = new Set(COACH_CHARACTERS.map((c) => c.speech.first));
    expect(firsts.size).toBeGreaterThanOrEqual(3);
  });

  it('口調の指示が、プロンプトにそのまま届いている', () => {
    const character = findCharacter('allure');
    const text = characterVoice('allure');
    expect(text).toContain(character.speech.first);
    expect(text).toContain(character.lines[0].say);
    // 中身と安全は、どのキャラクターでも変わらない。
    expect(text).toContain('安全のルール');
  });

  it('id が重複していない', () => {
    const ids = COACH_CHARACTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('男性コーチも女性コーチも選べる', () => {
    const genders = new Set(COACH_CHARACTERS.map((c) => c.gender));
    expect(genders.has('male')).toBe(true);
    expect(genders.has('female')).toBe(true);
    expect(COACH_CHARACTERS.filter((c) => c.gender === 'female').length).toBeGreaterThanOrEqual(2);
  });

  it('以前から選べた id は残っている（選択が黙って既定値に戻らない）', () => {
    for (const id of ['blaze', 'logic', 'warm', 'veteran']) {
      expect(findCharacter(id).id).toBe(id);
    }
  });

  it('未設定や未知の id では既定のキャラクターに落ちる', () => {
    expect(findCharacter(undefined).id).toBe(DEFAULT_CHARACTER_ID);
    expect(findCharacter('unknown-character').id).toBe(DEFAULT_CHARACTER_ID);
  });

  it('どのキャラクターでも、安全のルールは変わらないと明記する', () => {
    for (const character of COACH_CHARACTERS) {
      const voice = characterVoice(character.id);
      expect(voice).toContain('キャラクターは話し方だけを変える');
      expect(voice).toContain('痛みへの配慮');
    }
  });
});
