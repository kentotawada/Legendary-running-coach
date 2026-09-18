import type { RaceEntry, RacePriority, RunnerProfile } from './types';

/**
 * 出場予定の大会。
 *
 * 一つの大会だけを見ていると、シーズンに3つも4つも出る人の指導を誤る。
 * 「どれに合わせて仕上げるか（A）」「どれを練習として使うか（B / C）」を分けて持ち、
 * ピーキングとテーパリングをAレースから逆算する。
 */

export const RACE_PRIORITY_LABEL: Record<RacePriority, string> = {
  A: '最重要',
  B: '調整レース',
  C: '練習の一環',
};

export const RACE_PRIORITY_HINT: Record<RacePriority, string> = {
  A: '全力で狙う。ここに向けて仕上げる',
  B: '本番の予行演習。回復を挟むが、仕上げの対象にはしない',
  C: 'ポイント練習の代わり。タイムは狙わない',
};

const DAY_MS = 86_400_000;

/** その日の0時。日付だけを比べるため、時刻を落とす。 */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** YYYY-MM-DD を、ローカルの0時として読む。時差で1日ずれるのを避ける。 */
export function parseRaceDate(date: string | undefined): number | undefined {
  if (!date) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!match) {
    const loose = Date.parse(date);
    return Number.isNaN(loose) ? undefined : loose;
  }
  const [, y, m, d] = match;
  const parsed = new Date(Number(y), Number(m) - 1, Number(d));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.getTime();
}

/** 本番まであと何日か。今日なら0、過ぎていれば負。読めなければ undefined。 */
export function daysUntil(date: string | undefined, now: Date = new Date()): number | undefined {
  const target = parseRaceDate(date);
  if (target === undefined) return undefined;
  return Math.round((target - startOfDay(now)) / DAY_MS);
}

/** 日付の早い順。日付が読めないものは末尾へ回す。 */
export function sortRaces(races: RaceEntry[]): RaceEntry[] {
  return [...races].sort((a, b) => {
    const ta = parseRaceDate(a.date);
    const tb = parseRaceDate(b.date);
    if (ta === undefined && tb === undefined) return a.name.localeCompare(b.name);
    if (ta === undefined) return 1;
    if (tb === undefined) return -1;
    return ta - tb;
  });
}

/**
 * このランナーの大会一覧。
 * 大会を1つしか持てなかった頃の記録（goal.raceName / goal.raceDate）も、
 * ここで1件の大会として読む。既存のユーザーが登録済みの大会を失わないため。
 */
export function racesOf(profile: RunnerProfile): RaceEntry[] {
  const races = profile.races ?? [];
  const legacyName = profile.goal?.raceName?.trim();
  const legacyDate = profile.goal?.raceDate?.trim();

  if (!legacyName && !legacyDate) return sortRaces(races);

  // 同じ大会が二重に出ないよう、名前か日付が一致するものがあれば旧データは捨てる。
  const alreadyKnown = races.some(
    (race) => (legacyName && race.name === legacyName) || (legacyDate && race.date === legacyDate),
  );
  if (alreadyKnown) return sortRaces(races);

  return sortRaces([
    ...races,
    {
      id: 'legacy-goal-race',
      name: legacyName || '大会',
      date: legacyDate ?? '',
      priority: 'A',
    },
  ]);
}

/** まだ来ていない大会（当日を含む）。 */
export function upcomingRaces(profile: RunnerProfile, now: Date = new Date()): RaceEntry[] {
  return racesOf(profile).filter((race) => {
    const left = daysUntil(race.date, now);
    return left !== undefined && left >= 0;
  });
}

/** 終わった大会。新しい順。 */
export function pastRaces(profile: RunnerProfile, now: Date = new Date()): RaceEntry[] {
  return racesOf(profile)
    .filter((race) => {
      const left = daysUntil(race.date, now);
      return left !== undefined && left < 0;
    })
    .reverse();
}

/**
 * 仕上げの基準にする大会。
 * Aレースがあればその直近のもの、無ければ次に来る大会。
 */
export function targetRace(profile: RunnerProfile, now: Date = new Date()): RaceEntry | undefined {
  const upcoming = upcomingRaces(profile, now);
  return upcoming.find((race) => race.priority === 'A') ?? upcoming[0];
}

export interface RacePeriod {
  /** 「走り込み期」など。 */
  label: string;
  /** その時期に何を積むか。 */
  focus: string;
}

/**
 * 本番までの残り日数から、いま何を積む時期かを決める。
 * 残り日数だけで決まるので、サブ3でも完走狙いでも同じ枠組みが使える。
 * 変わるのは中身の強度で、それは「この人の基準」が持っている。
 */
export function periodFor(daysLeft: number): RacePeriod {
  if (daysLeft <= 0) return { label: 'レース当日', focus: '今日は走りきることだけ。新しいことは何もしない' };
  if (daysLeft <= 7) {
    return {
      label: 'レース週',
      focus: '新しい刺激を入れない。距離は5割以下に落とし、レースペースの短い刺激だけ残す。睡眠と補給が練習より効く',
    };
  }
  if (daysLeft <= 21) {
    return {
      label: '調整期（テーパー）',
      focus: '距離を毎週2〜3割落とす。強度（刺激）は残す。ここで走り足りない焦りが必ず出るので、先回りして肯定する',
    };
  }
  if (daysLeft <= 56) {
    return {
      label: '専門期',
      focus: 'レースペース走の比率を最も高くする。ロング走の後半にレースペースを組み込み、本番の再現度を上げる',
    };
  }
  if (daysLeft <= 112) {
    return {
      label: '走り込み期',
      focus: 'ロング走を段階的に伸ばし、閾値走を軸に置く。走行距離が最も伸びる時期。増やすのは前週比10%以内',
    };
  }
  return {
    label: '基礎期',
    focus: 'イージー中心で総量と脚を作る。ポイント練習は閾値走を週1回まで。ここで無理をしても本番には間に合わない',
  };
}

/** 大会1件を1行で。 */
export function describeRace(race: RaceEntry, now: Date = new Date()): string {
  const left = daysUntil(race.date, now);
  const parts = [race.name];
  if (race.date) {
    if (left === undefined) parts.push(race.date);
    else if (left > 0) parts.push(`${race.date}（あと${left}日）`);
    else if (left === 0) parts.push(`${race.date}（今日）`);
    else parts.push(`${race.date}（${-left}日前に終了）`);
  }
  if (race.distance) parts.push(race.distance);
  if (race.targetTime) parts.push(`目標 ${race.targetTime}`);
  parts.push(`${race.priority}レース・${RACE_PRIORITY_LABEL[race.priority]}`);
  if (race.note) parts.push(race.note);
  return parts.join(' / ');
}

/** フルマラソン後の回復に要する日数の目安。1マイルあたり1日。 */
const FULL_MARATHON_RECOVERY_DAYS = 26;

function isFullMarathon(race: RaceEntry): boolean {
  const text = `${race.distance ?? ''}`;
  return /フル|marathon|42/i.test(text);
}

/**
 * プロンプトに差し込む「大会の並び」。
 * 複数エントリーしている人には、どれに合わせて仕上げ、どれを練習として使うかを必ず言わせる。
 */
export function raceDoctrine(profile: RunnerProfile, now: Date = new Date()): string | null {
  const upcoming = upcomingRaces(profile, now);
  const past = pastRaces(profile, now);
  // 名前だけ聞けていて開催日が分からない大会。逆算ができないので、必ず日付を尋ねさせる。
  const undated = racesOf(profile).filter((race) => daysUntil(race.date, now) === undefined);
  const undatedLines =
    undated.length > 0
      ? [
          `- 開催日が分かっていない大会: ${undated.map((race) => race.name).join('、')}`,
          '  日付が無いと本番から逆算できない。会話の流れの中で一度だけ開催日を尋ね、add_race で登録すること。',
        ]
      : [];

  if (upcoming.length === 0 && undated.length > 0 && past.length === 0) {
    return ['# 出場予定の大会', ...undatedLines].join('\n');
  }

  if (upcoming.length === 0) {
    if (past.length === 0) return null;
    const recent = past[0];
    const since = daysUntil(recent.date, now);
    const lines = ['# 出場した大会', `- ${describeRace(recent, now)}`];
    if (since !== undefined && isFullMarathon(recent) && -since < FULL_MARATHON_RECOVERY_DAYS) {
      lines.push(
        `- **フルマラソンから${-since}日しか経っていない。** 回復の目安は3〜4週間。`,
        '  本人が走りたがっても、この期間にポイント練習を入れさせない。筋肉のダメージは自覚より長く残る。',
      );
    }
    lines.push(...undatedLines);
    if (undated.length === 0) {
      lines.push('- 次の目標となる大会が未登録。落ち着いたら、次に出たい大会があるか一度だけ尋ねる。');
    }
    return lines.join('\n');
  }

  const target = targetRace(profile, now);
  const lines = ['# 出場予定の大会'];
  for (const race of upcoming) {
    lines.push(`- ${describeRace(race, now)}${race.id === target?.id ? ' ← ここに合わせて仕上げる' : ''}`);
  }

  lines.push(...undatedLines);

  if (target) {
    const left = daysUntil(target.date, now);
    if (left !== undefined) {
      const period = periodFor(left);
      lines.push(
        '',
        `**${target.name}まであと${left}日。いまは「${period.label}」。**`,
        `- ${period.focus}`,
        '- メニューを出す時は、この時期の狙いから外れていないかを毎回確かめること。',
      );
    }
  }

  // 仕上げの対象ではない大会をどう扱うかを、必ず言葉にさせる。
  const others = upcoming.filter((race) => race.id !== target?.id);
  if (others.length > 0) {
    lines.push(
      '',
      `- ${target?.name ?? 'Aレース'} 以外の大会は、**仕上げの対象にしない。**`,
      '  B は本番の予行演習（補給・シューズ・ペース配分を試す場）、C はポイント練習の代わりとして扱う。',
      '  ただし「手を抜け」とは言わない。その大会にも意味があることを認めた上で、位置づけを説明する。',
    );

    // 大会が近接していると、回復を無視した計画になりやすい。
    const sorted = upcoming;
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const current = sorted[i];
      const gap = (parseRaceDate(current.date) ?? 0) - (parseRaceDate(prev.date) ?? 0);
      const gapDays = Math.round(gap / DAY_MS);
      if (gapDays >= 0 && gapDays <= 21 && (isFullMarathon(prev) || isFullMarathon(current))) {
        lines.push(
          `- **${prev.name} と ${current.name} の間が${gapDays}日しかない。**`,
          '  フルマラソン後の回復には3〜4週間かかる。両方を全力で走る前提の計画は立てないこと。',
          '  どちらを本命にするかを本人に確かめ、もう一方は完走ペースに落とす前提で組む。',
        );
        break;
      }
    }
  }

  return lines.join('\n');
}
