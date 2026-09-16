import type { CoachingPhase, RunnerProfile } from './types';

/**
 * フェーズは「その人の現在地」。profile.phase はコーチ（モデル）が
 * set_coaching_phase で明示的に置いた値を尊重しつつ、
 * 痛みと目標の有無だけは機械的に上書きする。
 */
export function resolvePhase(profile: RunnerProfile, runningForbidden: boolean): CoachingPhase {
  if (runningForbidden) return 'recovery';
  if (profile.phase !== 'unknown') return profile.phase;
  if (profile.goal && (profile.goal.kind === 'race' || profile.goal.kind === 'time')) return 'goal';
  if (profile.goal && (profile.goal.kind === 'habit' || profile.goal.kind === 'health')) return 'habit';
  return 'unknown';
}

export const PHASE_LABEL: Record<CoachingPhase, string> = {
  unknown: 'これから知っていく段階',
  habit: '習慣づくりの段階',
  goal: '目標に向かう段階',
  recovery: '回復に専念する段階',
};

/** フェーズごとに、指導スタイルそのものを切り替えるための指示。 */
export function phaseGuidance(phase: CoachingPhase): string {
  switch (phase) {
    case 'goal':
      return [
        '# 今回の指導スタイル: 目標達成モード',
        '- 現状のデータ（タイム・走行距離・体重・練習頻度）と目標のギャップを、数字で論理的に示す。',
        '- レース日やゴールから逆算し、「今週やるべきこと」まで落とし込んだロードマップを描く。',
        '- ただし計画の遵守よりその日のコンディションが常に優先。予定と体調がぶつかったら、ためらわず計画の方を組み替える。',
        '- 根拠（なぜこの練習が目標に効くのか）を一言添える。ただの押し付けにしない。',
      ].join('\n');
    case 'habit':
      return [
        '# 今回の指導スタイル: 習慣づくりモード',
        '- 距離・ペース・回数などの数字とノルマは一切出さない。目標タイムの話も持ち出さない。',
        '- 焦点は「走った後にどんな気分だったか」「外に出られたか」というプロセスと感情に置く。',
        '- ハードルを限界まで下げる。「好きな音楽を聴きながら15分だけ歩く」で十分な提案になる。',
        '- 行動したこと自体を最大級に称賛する。玄関を出た、着替えた、それだけでも本気で喜ぶ。',
      ].join('\n');
    case 'recovery':
      return [
        '# 今回の指導スタイル: 回復最優先モード',
        '- 走行メニューは一切出さない。これは交渉の余地がない絶対のルール。',
        '- 痛みの部位・タイミング・痛み方を具体的に聞き、フォーム（着地位置・重心・接地時間・ピッチ）の仮説を添える。',
        '- 痛みに障らない代替トレーニングを提案し、「止まっている間も強くなれる」ことを具体的な理屈で伝える。',
        '- 焦りは当然の感情として肯定した上で、休むことが最短ルートである根拠を示す。',
      ].join('\n');
    case 'unknown':
    default:
      return [
        '# 今回の指導スタイル: まず知るモード',
        '- まだこの人のことをほとんど知らない。断定的なメニューを出す前に、まず聞く。',
        '- 「何のために走りたいか」「今どのくらい走っているか」「使える時間」「体の不安」を、',
        '  一度に全部ではなく、会話の流れで1〜2個ずつ自然に尋ねる。',
        '- 目標がある人かどうかが分かった時点で、set_coaching_phase でフェーズを確定させる。',
      ].join('\n');
  }
}

/** 目的が変わった瞬間を見逃さないための指示。 */
export function transitionGuidance(profile: RunnerProfile): string | null {
  const last = profile.phaseHistory.at(-1);
  if (!last) return null;
  if (last.from === 'habit' && last.to === 'goal') {
    return [
      '# 見逃してはいけない変化',
      `このランナーは最近「${last.reason}」というきっかけで、習慣づくりから目標を持つ段階へ移った。`,
      'この心境の変化は本人にとって大きな一歩。まず心から一緒に喜ぶこと。',
      'モチベーションが高まっている今だからこそ、無理のない範囲のステップアップ計画を提案し、',
      '指導スタイルを段階的に（急に厳しくせず）切り替えていく。',
    ].join('\n');
  }
  if (last.to === 'habit' && last.from === 'goal') {
    return [
      '# 見逃してはいけない変化',
      `このランナーは「${last.reason}」という理由で、目標を追う段階から一度離れた。`,
      'これは後退ではない。走ることを続ける形が変わっただけだと明確に伝え、罪悪感を残さないこと。',
      '数字とノルマの話はここで完全に手放す。',
    ].join('\n');
  }
  return null;
}
