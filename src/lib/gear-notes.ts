/**
 * 「これは合わなかった」を覚えておくための層。
 *
 * ジェルが胃に来るか、靴下でマメが出るかは、人によって違います。
 * 一度そう言ったのに、次にまた同じ物を勧められるほど、
 * 「この人は自分の話を聞いていない」と感じさせるものはありません。
 *
 * 記録するのは本人の言葉そのままで、こちらで解釈を足しません。
 */

import type { GearNote, RunnerProfile } from './types';

/** そのカテゴリで避ける物。カテゴリ不明の記録は、どのカテゴリでも見る。 */
export function badGearFor(profile: RunnerProfile, category?: string): GearNote[] {
  return (profile.gearNotes ?? []).filter(
    (note) => note.verdict === 'bad' && (!category || !note.category || note.category === category),
  );
}

/** そのカテゴリで合っていた物。新しい物を勧める前に、まずこちらを思い出す。 */
export function goodGearFor(profile: RunnerProfile, category?: string): GearNote[] {
  return (profile.gearNotes ?? []).filter(
    (note) => note.verdict === 'good' && (!category || !note.category || note.category === category),
  );
}

/** プロンプトに差し込む、合う・合わないの記録。 */
export function gearNoteDoctrine(profile: RunnerProfile): string | null {
  const notes = profile.gearNotes ?? [];
  if (notes.length === 0) return null;

  const lines = ['# 使ってみた道具の合う・合わない（本人の言葉）'];
  for (const note of notes.slice(-12)) {
    lines.push(
      `- ${note.verdict === 'bad' ? '✕' : '○'} ${note.name}` +
        `${note.reason ? `: ${note.reason}` : ''}（${note.at}）`,
    );
  }
  lines.push(
    '',
    '- ✕ の物は**二度と勧めない。** 商品を探す時も自動で候補から外れる。',
    '- ○ の物が今の場面に使えるなら、新しい物を勧める前にそれを思い出させること。',
    '  すでに持っている物で足りるなら、それが一番いい答え。',
  );
  return lines.join('\n');
}
