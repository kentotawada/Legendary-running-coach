import { describe, expect, it } from 'vitest';
import { COACH_CHARACTERS, addressFor, characterVoice, findCharacter } from '@/lib/characters';
import { greetingFor } from '@/lib/greeting';
import { nudgeFor } from '@/lib/nudge';
import { addActivity, addRace, applyProfileUpdate, summarizeProfile, upsertPain } from '@/lib/profile';
import { buildSystemInstruction } from '@/lib/prompt';
import { createDefaultProfile } from '@/lib/types';
import type { RunnerProfile } from '@/lib/types';

/**
 * 何と呼ぶか。
 *
 * **「きみ」「あなた」と書かれた文章は、誰に向けたものでもない。**
 * 名前で呼ばれてはじめて、自分に向けられた言葉として読める。
 *
 * 名前を知らない間は、二人称に落とさず主語を省く。日本語はそれで通るし、
 * 借り物の「あなた」より、呼びかけないほうが距離が近い。
 */

const NOW = new Date('2026-09-27T10:00:00+09:00');
const base = () => createDefaultProfile('u1', NOW.toISOString());

/** 名前を持った人。敬称はコーチごとに変わるので、コーチも指定できるようにする。 */
function named(name: string, characterId = 'logic'): RunnerProfile {
  return applyProfileUpdate(base(), { displayName: name, characterId }, NOW);
}

/** 二人称。ここに挙げたものは、どこにも出てはいけない。 */
const PRONOUNS = ['きみ', 'あなた', '君'];

describe('呼び方を決める', () => {
  it('名前に、そのコーチの敬称を付ける', () => {
    expect(addressFor('logic', 'ケント')).toBe('ケントさん');
  });

  it('呼び捨てで話すコーチは、敬称を付けない', () => {
    // 岩井（熱血）と綾瀬（距離が近い）は、敬語で話さない人として書いてある。
    expect(addressFor('blaze', 'ケント')).toBe('ケント');
    expect(addressFor('allure', 'ケント')).toBe('ケント');
  });

  it('名前が無ければ null。**ここで二人称に落とさない。**', () => {
    expect(addressFor('logic', undefined)).toBeNull();
    expect(addressFor('logic', '')).toBeNull();
    // 空白だけの名前も、名前ではない。
    expect(addressFor('logic', '   ')).toBeNull();
  });

  it('前後の空白は落として呼ぶ', () => {
    expect(addressFor('logic', '  ケント  ')).toBe('ケントさん');
  });

  it('コーチを変えると、同じ名前でも呼び方が変わる', () => {
    expect(addressFor('logic', 'ケント')).toBe('ケントさん');
    expect(addressFor('blaze', 'ケント')).toBe('ケント');
  });
});

describe('口調の指示に、二人称を残さない', () => {
  /** **これが本題の回帰テスト。** 1人でも「きみ」で呼べば、その人を選んだ時に出る。 */
  it('名前を知っている時、二人称でなく名前で呼べと書いてある', () => {
    for (const character of COACH_CHARACTERS) {
      const voice = characterVoice(character.id, 'ケント');
      const address = addressFor(character.id, 'ケント')!;
      expect(voice, character.name).toContain(`「${address}」`);
      expect(voice, character.name).toContain('必ず一度、名前で呼ぶ');
    }
  });

  it('名前を知らない時は、二人称を使わず尋ねろと書いてある', () => {
    for (const character of COACH_CHARACTERS) {
      const voice = characterVoice(character.id, undefined);
      expect(voice, character.name).toContain('名前をまだ聞けていない');
      expect(voice, character.name).toContain('主語を省いて');
      expect(voice, character.name).toContain('displayName');
    }
  });

  /**
   * キャラクターの設定そのものに二人称が残っていないか。
   * **例文に「きみ」が1つ残っているだけで、モデルはそれを真似る。**
   */
  it('例文・口ぐせ・肩の一言にも、二人称が残っていない', () => {
    for (const character of COACH_CHARACTERS) {
      const written = [
        character.tagline,
        character.sample,
        ...character.speech.habits,
        ...character.voice,
        ...character.lines.map((line) => line.say),
        ...Object.values(character.greet),
      ].join('\n');

      for (const pronoun of PRONOUNS) {
        expect(written, `${character.name}: ${pronoun}`).not.toContain(pronoun);
      }
    }
  });
});

describe('画面を開いた時の一言', () => {
  const ran = (profile: RunnerProfile) =>
    addActivity(profile, { date: '2026-09-26', type: 'run', distanceKm: 12 }, NOW);

  it('名前で呼びかけてから話し始める', () => {
    const text = greetingFor(ran(named('ケント')), NOW).text;
    expect(text.startsWith('ケントさん、')).toBe(true);
  });

  it('呼び捨てのコーチなら、敬称なしで呼びかける', () => {
    const text = greetingFor(ran(named('ケント', 'allure')), NOW).text;
    expect(text).toContain('ケント、');
    expect(text).not.toContain('ケントさん');
  });

  /**
   * 「よし、来たな。」の頭に名前を置くと「ケント、よし、来たな。」になり、
   * 読点が続いて読みにくい。感動詞の後ろに入れる。
   */
  it('感動詞から始まる一言は、その後ろで名前を呼ぶ', () => {
    const text = greetingFor(ran(named('ケント', 'blaze')), NOW).text;
    expect(text.startsWith('よし、ケント、')).toBe(true);
    expect(text).not.toContain('ケント、よし');
  });

  /** **記録から来た言葉を、感動詞と間違えないこと。** 「右膝、3日目です。」は割らない。 */
  it('痛みの部位を、感動詞と取り違えない', () => {
    const hurt = upsertPain(ran(named('ケント')), { site: '右膝', severity: 3, since: '2026-09-25' }, NOW);
    const text = greetingFor(hurt, NOW).text;
    expect(text).toContain('右膝、2日目です。');
    expect(text.startsWith('ケントさん、右膝')).toBe(true);
  });

  it('名前が無ければ、呼びかけずにそのまま話す', () => {
    const text = greetingFor(ran(base()), NOW).text;
    // 「、」だけが先頭に残る、という壊れ方をしていないこと。
    expect(text.startsWith('、')).toBe(false);
    for (const pronoun of PRONOUNS) expect(text).not.toContain(pronoun);
  });

  it('痛みがある日も、名前から入る（結論は変わらない）', () => {
    const withPain = upsertPain(ran(named('ケント')), { site: '右膝', severity: 3, since: '2026-09-25' }, NOW);
    const greeting = greetingFor(withPain, NOW);
    expect(greeting.kind).toBe('pain');
    expect(greeting.text.startsWith('ケントさん、')).toBe(true);
  });

  it('どのコーチ・どの場面でも、二人称が出てこない', () => {
    const scenes: RunnerProfile[] = [
      base(),
      ran(base()),
      ran(named('ケント')),
      addRace(ran(named('ケント')), { name: '東京マラソン', date: '2026-10-01', priority: 'A' }, NOW),
    ];
    for (const character of COACH_CHARACTERS) {
      for (const scene of scenes) {
        const text = greetingFor({ ...scene, characterId: character.id }, NOW).text;
        for (const pronoun of PRONOUNS) {
          expect(text, `${character.name}: ${pronoun}`).not.toContain(pronoun);
        }
      }
    }
  });
});

describe('通知も、名前で呼ぶ', () => {
  /** ロック画面で目が止まるのは、自分の名前が見えた時だけ。 */
  const raceDay = (profile: RunnerProfile) =>
    addActivity(
      addRace(profile, { name: '東京マラソン', date: '2026-09-27', distance: 'フル', priority: 'A' }, NOW),
      { date: '2026-09-26', type: 'run', distanceKm: 8 },
      NOW,
    );

  it('見出しが名前から始まる', () => {
    const nudge = nudgeFor(raceDay(named('ケント')), NOW)!;
    expect(nudge.title.startsWith('ケントさん、')).toBe(true);
    // 中身は変えない。名前を足すだけ。
    expect(nudge.title).toContain('東京マラソン');
  });

  it('名前が無ければ、見出しをそのまま出す', () => {
    const nudge = nudgeFor(raceDay(base()), NOW)!;
    expect(nudge.title.startsWith('、')).toBe(false);
    expect(nudge.title).toContain('東京マラソン');
  });
});

describe('カルテとプロンプト', () => {
  it('カルテの呼び方が、実際に呼ばれる形で載る', () => {
    expect(summarizeProfile(named('ケント'), NOW)).toContain('呼び方: ケントさん');
    expect(summarizeProfile(named('ケント', 'blaze'), NOW)).toContain('呼び方: ケント');
  });

  it('名前が無ければ、呼び方の行を出さない', () => {
    expect(summarizeProfile(base(), NOW)).not.toContain('呼び方');
  });

  it('組み上げたプロンプトに、呼び方が届いている', () => {
    const text = buildSystemInstruction(named('ケント'), NOW);
    expect(text).toContain('ケントさん');
    expect(text).toContain('必ず一度、名前で呼ぶ');
  });
});

describe('名前は、あとから変えられる', () => {
  it('付け替えられる', () => {
    const renamed = applyProfileUpdate(named('ケント'), { displayName: 'けんと' }, NOW);
    expect(renamed.displayName).toBe('けんと');
    expect(addressFor(renamed.characterId, renamed.displayName)).toBe('けんとさん');
  });

  /**
   * 空文字は「まだ分からない」であって「消す」ではない、という applyProfileUpdate の約束は
   * 会話から拾う時のもの。**消す操作は API 側が受け持つ**（route.ts）。
   * ここでは、うっかり空で上書きされて名前が消えないことだけを確かめる。
   */
  it('空の更新で、名前が消えない', () => {
    const kept = applyProfileUpdate(named('ケント'), { displayName: '' }, NOW);
    expect(kept.displayName).toBe('ケント');
  });

  it('コーチを変えると、呼ばれ方だけが変わる（名前はそのまま）', () => {
    const moved = applyProfileUpdate(named('ケント'), { characterId: 'allure' }, NOW);
    expect(moved.displayName).toBe('ケント');
    expect(addressFor(moved.characterId, moved.displayName)).toBe('ケント');
    expect(findCharacter(moved.characterId).speech.honorific).toBe('');
  });
});


/**
 * 自分で敬称込みの呼び名を入れる人は多い（「げんさん」「まっちゃん」）。
 *
 * **そこに機械的に敬称を足すと「げんさんさん」になる。**
 * 呼び方は毎回の返事に出るので、目につく所ほど痛い。
 */
describe('敬称を二重に付けない', () => {
  it('「さん」で終わる名前に、もう一度「さん」を足さない', () => {
    expect(addressFor('logic', 'げんさん')).toBe('げんさん');
    expect(addressFor('logic', 'まっちゃん')).toBe('まっちゃん');
  });

  it('ふつうの名前には、いつも通り付ける', () => {
    expect(addressFor('logic', 'ケント')).toBe('ケントさん');
    expect(addressFor('logic', '田中')).toBe('田中さん');
  });

  it('前後の空白は落としたうえで判断する', () => {
    expect(addressFor('logic', '  げんさん  ')).toBe('げんさん');
  });

  it('ほかの敬称でも二重にしない', () => {
    for (const name of ['たろう君', 'はなちゃん', '先生様', 'みっちゃん']) {
      expect(addressFor('logic', name), name).toBe(name);
    }
  });

  it('呼び捨てで話すコーチは、もとから足さない', () => {
    // blaze は honorific が空。ここは変わらない。
    expect(addressFor('blaze', 'げんさん')).toBe('げんさん');
    expect(addressFor('blaze', 'ケント')).toBe('ケント');
  });

  it('名前が無ければ、これまで通り null', () => {
    expect(addressFor('logic', '')).toBeNull();
    expect(addressFor('logic', '   ')).toBeNull();
    expect(addressFor('logic', undefined)).toBeNull();
  });

  it('口調の指示にも、二重にならない呼び方が入る', () => {
    const voice = characterVoice('logic', 'げんさん');
    expect(voice).toContain('「げんさん」と呼ぶ');
    expect(voice).not.toContain('げんさんさん');
  });
});
