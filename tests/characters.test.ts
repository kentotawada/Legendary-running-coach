import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { COACH_CHARACTERS, DEFAULT_CHARACTER_ID, characterVoice, findCharacter } from '@/lib/characters';

describe('コーチのキャラクター', () => {
  it('選べるコーチが揃っていて、それぞれ選ぶ材料を持つ', () => {
    expect(COACH_CHARACTERS.length).toBeGreaterThanOrEqual(4);
    for (const character of COACH_CHARACTERS) {
      // 顔写真は必ず用意する。空の丸が並ぶと、誰を選んでいるのか分からない。
      expect(character.photo).toMatch(/^\/coaches\/.+\.webp$/);
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

  it('顔写真が実在する。参照だけあって画像が無いと、全員が頭文字になる', () => {
    for (const character of COACH_CHARACTERS) {
      expect(existsSync(`public${character.photo}`), character.name).toBe(true);
    }
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
