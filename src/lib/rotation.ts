/**
 * 今日、どの靴で走るか。
 *
 * **持っている靴を全部同じように履き潰す人が、いちばん多い。**
 * 1足を毎日履くより、2足を回したほうが故障が少ないことは分かっていて、
 * 理由も単純で、**同じ場所に同じ力が毎日かかるのをやめられる**から。
 *
 * それなのに、どの記録アプリも「今日はどれを履くか」は言わない。
 * 累計距離は出すのに、**その数字を使って今日の判断までは運ばない。**
 *
 * ## やらないこと
 *
 * - **買わせる話にしない。** 1足しか無い人に2足目を勧めるのは一度だけ、理由と一緒に。
 * - **寿命を断定しない。** 体重・走り方・路面で倍くらい違う。目安として扱う。
 */

import type { PlanIntensity, RunnerProfile, ShoeEntry } from './types';
import { SHOE_ROLE_LABEL, activeShoes, shoeStatusOf } from './shoes';

export interface ShoePick {
  shoe?: ShoeEntry;
  /** なぜその靴なのか。 */
  why: string;
  /** 寿命が近い時の一言。 */
  caution?: string;
  /** 2足目を持っていない人への、一度きりの提案。 */
  suggestSecond?: string;
}

/** レース用を出してよい強度。**イージーでカーボンを履かせない。** */
function wantsRaceShoe(intensity: PlanIntensity, raceSoon: boolean): boolean {
  return raceSoon || intensity === 'hard';
}

/**
 * 今日の1足。
 *
 * 選び方は単純で、**同じ靴を続けて履かせない**こと。
 * 役割が合う靴のうち、いちばん距離の少ないものを出す。
 */
export function shoeForToday(
  profile: RunnerProfile,
  intensity: PlanIntensity,
  options: { raceSoon?: boolean } = {},
): ShoePick | null {
  const shoes = activeShoes(profile);
  if (shoes.length === 0) return null;
  if (intensity === 'rest') return null;

  const race = wantsRaceShoe(intensity, options.raceSoon === true);
  const wanted = shoes.filter((shoe) => (race ? shoe.role === 'race' : shoe.role !== 'race'));
  const pool = wanted.length > 0 ? wanted : shoes;

  // **いちばん距離の少ないものから履く。** 同じ場所に同じ力が毎日かかるのを避ける。
  const shoe = pool.slice().sort((a, b) => a.km - b.km)[0];
  const status = shoeStatusOf(shoe, profile);

  const why = race
    ? `${SHOE_ROLE_LABEL[shoe.role]}の1足です。速く走る日だけに取っておくと、大事な日に本来の反発が残ります。`
    : pool.length > 1
      ? `持っている中で、いちばん距離が少ない1足です。同じ靴を続けて履かないほうが、脚の同じ場所に力が集まりません。`
      : `いまあるのはこの1足です。`;

  const caution =
    status.level === 'over'
      ? `${Math.round(shoe.km)}km。目安の${status.lifespan.replace}kmを超えています。張りが出る前に、次の1足を考える頃です。`
      : status.level === 'caution'
        ? `${Math.round(shoe.km)}km。替え時が近づいています（目安${status.lifespan.replace}km）。`
        : undefined;

  /*
    **買わせる話にしない。** 1足しか無い人にだけ、理由と一緒に一度。
    走る量が少ないうちは、2足目の効き目も小さいので、ある程度積んでいる人に限る。
  */
  const totalKm = shoes.reduce((sum, item) => sum + item.km, 0);
  const suggestSecond =
    shoes.length === 1 && totalKm >= 150
      ? '2足を交互に履くと、同じ場所に毎回同じ力がかかるのを避けられます。1足を履き潰すより、結果的に長く使えます。'
      : undefined;

  return { shoe, why, caution, suggestSecond };
}

/**
 * プロンプトに差し込む、今日の1足。
 * **画面に出ている靴と、コーチの言う靴を食い違わせない。**
 */
export function rotationDoctrine(
  profile: RunnerProfile,
  intensity: PlanIntensity,
  options: { raceSoon?: boolean } = {},
): string | null {
  const pick = shoeForToday(profile, intensity, options);
  if (!pick?.shoe) return null;

  const lines = [
    '# 画面に出ている「今日の1足」（**本人はもう見ている**）',
    `- ${pick.shoe.name}（${SHOE_ROLE_LABEL[pick.shoe.role]} / ${Math.round(pick.shoe.km)}km）`,
    `- 理由として出している言葉: ${pick.why}`,
  ];
  if (pick.caution) lines.push(`- 替え時について: ${pick.caution}`);
  if (pick.suggestSecond) lines.push('- 2足目の提案も出している。**繰り返し勧めないこと。**');
  lines.push(
    '- **寿命を断定しないこと。** 体重・走り方・路面で倍くらい違う。あくまで目安。',
    '- **買わせる方向に寄せないこと。** 聞かれた時だけ、具体名を出す。',
  );
  return lines.join('\n');
}
