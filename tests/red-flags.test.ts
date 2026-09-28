import { describe, expect, it } from 'vitest';
import {
  activeRedFlag,
  clearRedFlags,
  coversRedFlag,
  detectRedFlags,
  guardRedFlagReply,
  recordRedFlag,
  redFlagDirectives,
  redFlagNotice,
} from '@/lib/red-flags';
import { assessSafety } from '@/lib/safety';
import { greetingFor } from '@/lib/greeting';
import { executeTool } from '@/lib/tools';
import { applyProfileUpdate } from '@/lib/profile';
import { createDefaultProfile } from '@/lib/types';

/**
 * 胸の痛み・意識が遠のく感じ・めまい。
 *
 * **膝の痛みとは種類が違う。** 心臓・脳・呼吸の兆候かもしれず、「休めば治る」では済まないことがある。
 * これまでコーチは、これを拾えず、受診も 119 番も言わないまま練習の話を続けうる作りだった。
 *
 * 拾いすぎは許す。拾い漏らしは許さない。
 */

const NOW = new Date('2026-09-28T09:00:00+09:00');
const base = () => applyProfileUpdate(createDefaultProfile('u1', NOW.toISOString()), { displayName: 'ケント' }, NOW);

describe('危険な兆候を拾う', () => {
  it.each([
    ['走っていたら胸が苦しくなった', 'emergency', '胸の痛み'],
    ['胸が痛いです', 'emergency', '胸の痛み'],
    ['ゴール後に胸が締め付けられる感じがした', 'emergency', '胸の痛み'],
    ['胸痛があった', 'emergency', '胸の痛み'],
    ['レース中に意識が遠のいた', 'emergency', '意識が遠のく感じ'],
    ['ゴールしたあと倒れた', 'emergency', '意識が遠のく感じ'],
    ['ろれつが回らない', 'emergency', 'ろれつが回らない・片側のしびれ'],
    ['息ができない', 'emergency', '息ができない'],
    ['いつもより息苦しかった', 'warning', 'いつもと違う息苦しさ'],
    ['動悸がする', 'warning', '動悸・脈の乱れ'],
    ['脈が飛ぶ感じがある', 'warning', '動悸・脈の乱れ'],
    ['走り終わってめまいがした', 'warning', 'めまい・ふらつき'],
    ['ふらついて目の前が暗くなった', 'warning', 'めまい・ふらつき'],
    ['冷や汗が止まらない', 'warning', '冷や汗'],
  ])('「%s」→ %s', (text, level, sign) => {
    const flag = detectRedFlags(text);
    expect(flag?.level).toBe(level);
    expect(flag?.signs).toContain(sign);
  });

  it('重いものと軽いものが混ざったら、重い方にする', () => {
    const flag = detectRedFlags('めまいがして、胸も苦しかった');
    expect(flag?.level).toBe('emergency');
    expect(flag?.signs[0]).toBe('胸の痛み');
    expect(flag?.signs).toContain('めまい・ふらつき');
  });
});

describe('拾わないもの', () => {
  /** きつい練習の後なら普通に起きることで、いちいち止めない。 */
  it.each([
    'インターバルで息が上がった',
    '心臓がバクバクするくらい追い込んだ',
    '胸を張って走るのを意識した',
    '今日は10km走りました',
    '右膝が少し痛い',
  ])('「%s」', (text) => {
    expect(detectRedFlags(text)).toBeNull();
  });

  /** 打ち消しは、兆候にくっついている時だけ見る。 */
  it.each([
    '胸の痛みはない',
    '胸が痛くない',
    '胸が痛くならなかった',
    'めまいはありません',
    'めまいもなかった',
    '動悸は出なかった',
    '息苦しくない',
    '胸痛なし',
  ])('打ち消している「%s」', (text) => {
    expect(detectRedFlags(text)).toBeNull();
  });

  /** **離れた「ない」で、本物を見逃さない。** 眠れないのは本当で、動悸も本当にある。 */
  it('「動悸がして眠れない」は、動悸を拾う', () => {
    expect(detectRedFlags('動悸がして眠れない')?.signs).toContain('動悸・脈の乱れ');
  });

  it('片方だけ打ち消しても、もう片方は拾う', () => {
    const flag = detectRedFlags('胸の痛みはないけど、めまいがする');
    expect(flag?.level).toBe('warning');
    expect(flag?.signs).toEqual(['めまい・ふらつき']);
  });
});

describe('返答に、欠かせない文を必ず入れる', () => {
  const emergency = detectRedFlags('胸が苦しい')!;
  const warning = detectRedFlags('めまいがした')!;

  it('重い兆候では、モデルが何を書いても先頭に 119 番の文を置く', () => {
    const reply = guardRedFlagReply('ケントさん、すぐに休んでください。119番も考えて。', emergency);
    expect(reply.startsWith(redFlagNotice(emergency))).toBe(true);
    expect(reply).toContain('119');
  });

  it('軽い兆候では、受診の話が抜けていた時だけ足す', () => {
    const missing = guardRedFlagReply('今日はゆっくり休みましょう。', warning);
    expect(missing).toContain('受診');
    const covered = '今日は休みましょう。続くようなら循環器内科を受診してください。';
    expect(guardRedFlagReply(covered, warning)).toBe(covered);
  });

  it('モデルが何も書けなくても、文は出す', () => {
    expect(guardRedFlagReply('', emergency)).toBe(redFlagNotice(emergency));
  });

  it('重い兆候の文には、やめる・119 が入っている', () => {
    const notice = redFlagNotice(emergency);
    expect(notice).toContain('運動をやめて');
    expect(coversRedFlag(notice, emergency)).toBe(true);
  });
});

describe('記録に残し、診てもらうまで練習を出さない', () => {
  it('記録すると、指示文の先頭に強制の指示が入る', () => {
    const profile = recordRedFlag(base(), detectRedFlags('胸が苦しい')!, NOW);
    const safety = assessSafety(profile, NOW);
    expect(safety.redFlag?.record.level).toBe('emergency');
    expect(safety.directives[0]).toContain('最優先・安全');
    expect(safety.directives.join('\n')).toContain('119');
  });

  /** 胸の痛みに、膝の痛みの指示（フォームの仮説など）を当てない。 */
  it('痛みとは別に持つ（痛みの指示は混ざらない）', () => {
    const profile = recordRedFlag(base(), detectRedFlags('胸が苦しい')!, NOW);
    const safety = assessSafety(profile, NOW);
    expect(safety.runningForbidden).toBe(false);
    expect(safety.directives.join('\n')).not.toContain('フォーム面の仮説');
  });

  it('次の日以降は、その後と受診を確かめる指示になる', () => {
    const profile = recordRedFlag(base(), detectRedFlags('胸が苦しい')!, NOW);
    const later = new Date(NOW.getTime() + 3 * 86_400_000);
    const active = activeRedFlag(profile, later)!;
    expect(active.daysAgo).toBe(3);
    expect(redFlagDirectives(active).join('\n')).toContain('医師に診てもらったか');
  });

  it('重い兆候は2週間、軽い兆候は3日で期限が切れる', () => {
    const heavy = recordRedFlag(base(), detectRedFlags('胸が苦しい')!, NOW);
    const light = recordRedFlag(base(), detectRedFlags('めまいがした')!, NOW);
    const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
    expect(activeRedFlag(heavy, day(13))).not.toBeNull();
    expect(activeRedFlag(heavy, day(14))).toBeNull();
    expect(activeRedFlag(light, day(2))).not.toBeNull();
    expect(activeRedFlag(light, day(3))).toBeNull();
  });

  it('作り直しで同じ文章が届いても、二重に残さない', () => {
    const flag = detectRedFlags('胸が苦しい')!;
    const once = recordRedFlag(base(), flag, NOW);
    const twice = recordRedFlag(once, flag, new Date(NOW.getTime() + 60_000));
    expect(twice.redFlags).toHaveLength(1);
  });
});

describe('解除する', () => {
  it('理由があれば解除でき、解除すると練習の禁止が外れる', () => {
    const profile = recordRedFlag(base(), detectRedFlags('胸が苦しい')!, NOW);
    const outcome = executeTool(profile, 'clear_red_flag', { reason: '循環器内科で検査して異常なし' }, NOW);
    expect(outcome.result.ok).toBe(true);
    expect(activeRedFlag(outcome.profile, NOW)).toBeNull();
    expect(outcome.profile.redFlags?.[0].clearedReason).toBe('循環器内科で検査して異常なし');
  });

  it('理由が無ければ解除しない（推測で外させない）', () => {
    const profile = recordRedFlag(base(), detectRedFlags('胸が苦しい')!, NOW);
    const outcome = executeTool(profile, 'clear_red_flag', {}, NOW);
    expect(outcome.result.ok).toBe(false);
    expect(activeRedFlag(outcome.profile, NOW)).not.toBeNull();
  });

  it('解除したあとに同じ訴えがあれば、また記録する', () => {
    const flag = detectRedFlags('胸が苦しい')!;
    const cleared = clearRedFlags(recordRedFlag(base(), flag, NOW), '異常なし', NOW);
    const again = recordRedFlag(cleared, flag, new Date(NOW.getTime() + 60_000));
    expect(activeRedFlag(again, new Date(NOW.getTime() + 60_000))).not.toBeNull();
  });
});

describe('開いた時の一言', () => {
  it('訴えが残っていれば、何よりも先に、その後を聞く', () => {
    const profile = recordRedFlag(base(), detectRedFlags('胸が苦しい')!, NOW);
    const greeting = greetingFor(profile, new Date(NOW.getTime() + 86_400_000));
    expect(greeting.kind).toBe('redflag');
    expect(greeting.text).toContain('昨日の胸の痛み、その後どうですか');
    expect(greeting.text).toContain('119');
    expect(greeting.text.startsWith('ケントさん、')).toBe(true);
  });

  it('解除されていれば、ふだんの一言に戻る', () => {
    const profile = clearRedFlags(recordRedFlag(base(), detectRedFlags('胸が苦しい')!, NOW), '異常なし', NOW);
    expect(greetingFor(profile, NOW).kind).not.toBe('redflag');
  });
});
