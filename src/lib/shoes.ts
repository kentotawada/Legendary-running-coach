/**
 * シューズの寿命。
 *
 * ミッドソールは、見た目では分からないまま潰れます。
 * アウトソールに溝が残っていても、クッションと反発は先に死んでいる。
 * 「まだ履けそう」で走り続けて故障するのは、いちばんもったいない壊れ方です。
 *
 * だから走った距離を積んで、**こちらから**知らせます。
 * 買い替えを勧めるためではなく、脚を守るために。
 */

import type { RunnerProfile, ShoeEntry, ShoeRole } from './types';

export const SHOE_ROLE_LABEL: Record<ShoeRole, string> = {
  daily: '練習用',
  race: 'レース用',
};

export interface ShoeLifespan {
  /** そろそろ次を考え始める距離(km)。 */
  caution: number;
  /** 履き替えたい距離(km)。 */
  replace: number;
}

/**
 * 用途ごとの寿命の目安。
 *
 * 練習用は500〜700km。カーボンプレートのレース用はフォームが薄く軽いぶん早く、
 * 200〜300kmで反発が落ちるとされる。
 * 体重が重いほどフォームの圧縮は早いので、ここも少し動かす。
 */
export function lifespanFor(role: ShoeRole, bodyWeightKg?: number): ShoeLifespan {
  const base: ShoeLifespan = role === 'race' ? { caution: 200, replace: 300 } : { caution: 500, replace: 700 };
  const factor = bodyWeightKg === undefined ? 1 : bodyWeightKg >= 75 ? 0.9 : bodyWeightKg <= 55 ? 1.1 : 1;
  return {
    caution: Math.round((base.caution * factor) / 10) * 10,
    replace: Math.round((base.replace * factor) / 10) * 10,
  };
}

/** まだ現役のシューズ。走った距離の多い順。 */
export function activeShoes(profile: RunnerProfile): ShoeEntry[] {
  return [...(profile.shoes ?? [])].filter((shoe) => !shoe.retiredAt).sort((a, b) => b.km - a.km);
}

export type ShoeLevel = 'ok' | 'caution' | 'over';

export interface ShoeStatus {
  shoe: ShoeEntry;
  lifespan: ShoeLifespan;
  /** 交換の目安まで残り何km（超えていれば負）。 */
  remainingKm: number;
  /** 0〜1以上。進み具合の表示に使う。 */
  ratio: number;
  level: ShoeLevel;
  /** いまの走行距離のままなら、あと何週でその距離に届くか。 */
  weeksLeft?: number;
}

/**
 * 1足の今の状態。
 * 残り何週かまで出すのは、「あと120km」より「あと2週間」の方が、
 * 買うか買わないかを決められる形だから。
 */
export function shoeStatusOf(shoe: ShoeEntry, profile: RunnerProfile): ShoeStatus {
  const lifespan = lifespanFor(shoe.role, profile.bodyWeightKg);
  const remainingKm = Math.round(lifespan.replace - shoe.km);
  const ratio = lifespan.replace > 0 ? shoe.km / lifespan.replace : 0;

  // 練習用が何足あるかで、1足あたりの週の距離が変わる。
  const sameRole = activeShoes(profile).filter((entry) => entry.role === shoe.role).length || 1;
  const weekly = profile.weeklyVolumeKm;
  const perWeek = weekly !== undefined && weekly > 0 ? weekly / sameRole : undefined;

  return {
    shoe,
    lifespan,
    remainingKm,
    ratio,
    level: shoe.km >= lifespan.replace ? 'over' : shoe.km >= lifespan.caution ? 'caution' : 'ok',
    weeksLeft:
      perWeek !== undefined && remainingKm > 0 ? Math.max(1, Math.round(remainingKm / perWeek)) : undefined,
  };
}

export function shoeStatuses(profile: RunnerProfile): ShoeStatus[] {
  return activeShoes(profile).map((shoe) => shoeStatusOf(shoe, profile));
}

/** 名前で1足を探す。表記ゆれ（空白・大小）を吸収する。 */
export function findShoe(profile: RunnerProfile, nameOrId: string): ShoeEntry | undefined {
  const key = nameOrId.trim().toLowerCase().replace(/\s+/g, '');
  if (!key) return undefined;
  const shoes = profile.shoes ?? [];
  const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '');
  return (
    shoes.find((shoe) => shoe.id === nameOrId) ??
    shoes.find((shoe) => normalize(shoe.name) === key) ??
    shoes.find((shoe) => normalize(shoe.name).includes(key) || key.includes(normalize(shoe.name)))
  );
}

/**
 * 走った距離を、どの足に積むか。
 *
 * 2足以上あるのに指定が無い時は、**当てずっぽうで積まない**。
 * 間違った足の距離が増えると、寿命の判断ごと狂う。
 */
export function attributeRun(
  profile: RunnerProfile,
  name: string | undefined,
  role: ShoeRole = 'daily',
): ShoeEntry | undefined {
  if (name) return findShoe(profile, name);
  const active = activeShoes(profile);
  if (active.length === 1) return active[0];
  const sameRole = active.filter((shoe) => shoe.role === role);
  return sameRole.length === 1 ? sameRole[0] : undefined;
}

/** プロンプトに差し込む、シューズの状態。 */
export function shoeDoctrine(profile: RunnerProfile, now: Date = new Date()): string | null {
  const statuses = shoeStatuses(profile);
  if (statuses.length === 0) {
    // 一度も登録が無い時は、しつこく聞かせない。道具の話が出た時に拾えれば十分。
    return [
      '# シューズ',
      '- 登録なし。シューズの話題が出た時に、銘柄と「だいたい何km履いたか」を一度だけ尋ね、add_shoes で登録する。',
      '  聞き出すこと自体が目的ではない。会話の流れを止めてまで聞かない。',
    ].join('\n');
  }

  const lines = ['# シューズ（走行距離は記録済み。自分で数え直さないこと）'];
  for (const status of statuses) {
    const { shoe, lifespan, remainingKm, weeksLeft, level } = status;
    const parts = [
      `${shoe.name}（${SHOE_ROLE_LABEL[shoe.role]}）: ${Math.round(shoe.km)}km / 目安${lifespan.replace}km`,
    ];
    if (level === 'over') {
      parts.push(`**目安を${-remainingKm}km超えている。** ミッドソールはもう戻らない`);
    } else if (level === 'caution') {
      parts.push(`残り${remainingKm}km${weeksLeft !== undefined ? `（今のペースであと約${weeksLeft}週）` : ''}`);
    } else if (weeksLeft !== undefined) {
      parts.push(`残り${remainingKm}km（約${weeksLeft}週）`);
    }
    lines.push(`- ${parts.join(' / ')}`);
  }

  const worn = statuses.filter((status) => status.level !== 'ok');
  if (worn.length > 0) {
    lines.push(
      '',
      `- **${worn.map((status) => status.shoe.name).join('、')}は寿命が近い。** 次に脚の張りや膝の違和感を聞いた時、`,
      '  真っ先にここを疑うこと。距離だけを理由に買い替えを迫らない。',
      '  「あと何週で交換時期」という形で先に伝えておけば、本人が自分で決められる。',
    );
  }

  const daily = statuses.filter((status) => status.shoe.role === 'daily');
  const weekly = profile.weeklyVolumeKm;
  if (daily.length === 1 && weekly !== undefined && weekly >= 50) {
    lines.push(
      `- 週${weekly}kmを1足で受け止めている。2足を交互に履くと、ミッドソールが1日休めるぶん寿命が延びる。`,
    );
  }

  const unlogged = profile.activities.filter(
    (activity) =>
      activity.type === 'run' &&
      activity.distanceKm !== undefined &&
      !activity.shoeId &&
      Date.parse(activity.createdAt) > now.getTime() - 14 * 86_400_000,
  ).length;
  if (unlogged > 0 && activeShoes(profile).length >= 2) {
    lines.push(
      `- 直近の${unlogged}回は、どの靴で走ったかが分かっていない（2足以上あるため自動では積んでいない）。`,
      '  次に練習の報告を受けた時、ついでに一度だけ尋ねて log_activity の shoes に入れること。',
    );
  }

  return lines.join('\n');
}
