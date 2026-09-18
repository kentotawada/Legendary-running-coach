import { describe, expect, it } from 'vitest';
import { COACH_CHARACTERS, DEFAULT_CHARACTER_ID, characterVoice, findCharacter } from '@/lib/characters';

describe('コーチのキャラクター', () => {
  it('選べるキャラクターが揃っていて、それぞれ顔と説明を持つ', () => {
    expect(COACH_CHARACTERS.length).toBeGreaterThanOrEqual(4);
    for (const character of COACH_CHARACTERS) {
      expect(character.face.length).toBeGreaterThan(0);
      expect(character.name.length).toBeGreaterThan(0);
      expect(character.description.length).toBeGreaterThan(10);
      expect(character.voice.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('id が重複していない', () => {
    const ids = COACH_CHARACTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
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
