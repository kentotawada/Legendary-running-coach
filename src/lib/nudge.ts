/**
 * こちらから声をかける一言を決める。
 *
 * 開かなければ何も起きない、を壊すための層です。
 * ただし**通知は、簡単に嫌われます。** ここでの原則は3つ。
 *
 *  1. **1日に1通まで。** 2通目が来た時点で、人は設定を切りに行く。
 *  2. **責めない。** 「3日走っていません」は通知ではなく催促。走れない日には理由がある。
 *  3. **その人の数字を入れる。** 「そろそろ走りましょう」は誰にでも送れる＝誰にも効かない。
 */

import type { RunnerProfile } from './types';
import { daysUntil, targetRace } from './races';
import { shoeStatuses } from './shoes';
import { fuelPlanFor } from './gear-spec';
import { coachDate, coachWeekday } from './day';

export interface Nudge {
  /** 種類。同じ種類を続けて出さないための鍵。 */
  tag: string;
  title: string;
  body: string;
  /** 同じ種類を、次に出してよくなるまでの日数。 */
  cooldownDays: number;
}

const DAY_MS = 86_400_000;

function ymd(date: Date): string {
  return coachDate(date);
}

function daysSince(iso: string | undefined, now: Date): number | undefined {
  if (!iso) return undefined;
  const value = Date.parse(iso.length <= 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(value)) return undefined;
  return Math.floor((now.getTime() - value) / DAY_MS);
}

/** 最後に何か記録した日からの日数。走った日だけでなく、体調の記録も含める。 */
function quietDays(profile: RunnerProfile, now: Date): number | undefined {
  const dates = [
    ...(profile.activities ?? []).map((activity) => activity.date),
    ...(profile.conditionLogs ?? []).map((log) => log.date),
  ].sort();
  const latest = dates.at(-1);
  return daysSince(latest, now);
}

/** 今日すでに送っているか。 */
export function alreadySentToday(profile: RunnerProfile, now: Date): boolean {
  const last = profile.notifications?.lastSentAt;
  if (!last) return false;
  return daysSince(last, now) === 0;
}

function onCooldown(profile: RunnerProfile, tag: string, cooldownDays: number, now: Date): boolean {
  const sent = profile.notifications?.sentOn?.[tag];
  const since = daysSince(sent, now);
  return since !== undefined && since < cooldownDays;
}

/**
 * 今日送るべき一言。無ければ null。
 * **無いことの方が多くて正常です。** 毎日送る理由は、こちらの都合でしかない。
 */
export function nudgeFor(profile: RunnerProfile, now: Date = new Date()): Nudge | null {
  // ここは全員ぶんを順に回る場所。**1人の欠けた記録で、全員の通知を止めない。**
  // 保存が古くて配列そのものが無いことがあるので、必ず既定値を敷いてから触る。
  if (alreadySentToday(profile, now)) return null;

  const candidates: Nudge[] = [];
  const race = targetRace(profile, now);
  const left = race ? daysUntil(race.date, now) : undefined;

  // 1. 本番。この日だけは、何を措いても声をかける価値がある。
  if (race && left === 0) {
    candidates.push({
      tag: 'race-day',
      title: `${race.name}、いってらっしゃい`,
      body: '積んできたものは変わりません。前半を抑えて、最後まで自分のペースで。',
      cooldownDays: 1,
    });
  } else if (race && left !== undefined && left >= 1 && left <= 3) {
    const plan = fuelPlanFor(profile, now);
    candidates.push({
      tag: 'race-soon',
      title: `${race.name}まであと${left}日`,
      body: plan
        ? `ジェル${plan.gels}本は揃いましたか。新しい物は使わず、試した物だけで。`
        : '持ち物と当日の段取りを、今のうちに確かめておきましょう。',
      cooldownDays: 2,
    });
  } else if (race && left !== undefined && left >= 4 && left <= 14) {
    candidates.push({
      tag: 'race-two-weeks',
      title: `${race.name}まであと${left}日`,
      body: '距離を落として刺激だけ残す時期です。走り足りない焦りは、出て当たり前。',
      cooldownDays: 7,
    });
  }

  // 2. 靴。放っておくと、ある日ふくらはぎに出る。
  const worn = shoeStatuses(profile).find((status) => status.level === 'over');
  if (worn) {
    candidates.push({
      tag: 'shoes',
      title: `${worn.shoe.name}が${Math.round(worn.shoe.km)}kmです`,
      body: `目安の${worn.lifespan.replace}kmを超えました。脚の張りが出る前に、次の1足を考える頃です。`,
      cooldownDays: 14,
    });
  }

  // 3. 痛み。長引いているなら、受診という選択肢を一度は出す。
  const lingering = (profile.pains ?? [])
    .filter((pain) => pain.status !== 'resolved' && pain.severity >= 1)
    .map((pain) => ({ pain, days: daysSince(pain.since ?? pain.updatedAt, now) ?? 0 }))
    .find((entry) => entry.days >= 14);
  if (lingering) {
    candidates.push({
      tag: 'pain',
      title: `${lingering.pain.site}はどうですか`,
      body: '2週間以上続く痛みは、一度みてもらう価値があります。走れる体を残すための受診です。',
      cooldownDays: 14,
    });
  }

  // 4. しばらく記録が無い。**責めない。** 走れない日には理由がある。
  const quiet = quietDays(profile, now);
  if (quiet !== undefined && quiet >= 4) {
    candidates.push({
      tag: 'quiet',
      title: 'その後どうですか',
      body: '走れていなくても大丈夫です。今日の体の感じだけ、ひとこと聞かせてください。',
      cooldownDays: 5,
    });
  }

  // 5. 日曜の夜に、今週をふりかえる。
  if (coachWeekday(now) === 0 && (profile.activities ?? []).length > 0) {
    const weekKm = (profile.activities ?? [])
      .filter((activity) => (daysSince(activity.date, now) ?? 99) < 7)
      .reduce((sum, activity) => sum + (activity.distanceKm ?? 0), 0);
    if (weekKm > 0) {
      candidates.push({
        tag: 'weekly',
        title: `今週は ${Math.round(weekKm)}km でした`,
        body: '来週の組み立てを一緒に決めましょう。疲れの残り方も教えてください。',
        cooldownDays: 6,
      });
    }
  }

  return candidates.find((nudge) => !onCooldown(profile, nudge.tag, nudge.cooldownDays, now)) ?? null;
}

/** 送ったことを記録する。次に同じ知らせを出さないため。 */
export function markNotified(profile: RunnerProfile, tag: string, now: Date = new Date()): RunnerProfile {
  return {
    ...profile,
    notifications: {
      lastSentAt: now.toISOString(),
      lastTag: tag,
      sentOn: { ...(profile.notifications?.sentOn ?? {}), [tag]: ymd(now) },
    },
    updatedAt: now.toISOString(),
  };
}
