import { coachDate, daysBetween } from './day';
import { findCharacter } from './characters';
import { upcomingRaces, daysUntil } from './races';
import { assessSafety } from './safety';
import { shoeStatuses } from './shoes';
import type { ActivityLog, RunnerProfile } from './types';

/**
 * 画面を開いた時に、コーチのほうから言う一言。
 *
 * **黙っているコーチは、コーチではない。**
 * 1666km 分の記録が入っていても、開いた画面が真っ白で、
 * 相手が自分から文章を打ち始めるまで何も起きないなら、それは道具ですらない。
 *
 * 作りの方針:
 *  - **モデルに書かせない。** 開いた瞬間に出したいので待たせられないし、
 *    開くたびに生成していては、毎日使う道具として費用が見合わない。
 *    事実はここが組み立て、言い回しはキャラクターが持つ
 *  - **言うことは1つだけ。** 痛みも靴もレースも全部並べたら、ただの通知欄になる
 *  - **痛みがある時は、必ず痛みの話から入る。** ここだけは誰を選んでも結論が同じ
 *  - 作り話をしない。記録に無いことは言わない
 */

export type GreetingKind =
  | 'empty'
  | 'pain'
  | 'race'
  | 'back'
  | 'recent'
  | 'shoes'
  | 'plain';

export interface Greeting {
  /** そのまま画面に出す文章。 */
  text: string;
  /** なぜこの挨拶になったか。**画面には出さない。** 確かめるためのもの。 */
  kind: GreetingKind;
}

/** これだけ空いたら「久しぶり」。休養日2日は、間が空いたとは言わない。 */
const AWAY_DAYS = 4;

/** これより前の練習は、もう「この前の」ではない。 */
const RECENT_DAYS = 3;

/** ここまで近づいたら、練習の話より本番の話。 */
const RACE_NEAR_DAYS = 10;

/** ここから先は、まだ本番の話をする時期ではない。 */
const RACE_FAR_DAYS = 45;

function latestRun(profile: RunnerProfile): ActivityLog | undefined {
  return profile.activities
    .filter((activity) => activity.date)
    .reduce<ActivityLog | undefined>(
      (latest, activity) => (!latest || activity.date > latest.date ? activity : latest),
      undefined,
    );
}

/** 「今日」「昨日」「3日前」。**日付そのものを出しても、誰も数えない。** */
function whenWord(days: number): string {
  if (days <= 0) return '今日';
  if (days === 1) return '昨日';
  return `${days}日前`;
}

/** その練習を一息で言う。持っている分だけ並べ、無いものは黙って飛ばす。 */
function runFact(run: ActivityLog, days: number): string {
  const parts: string[] = [];
  if (run.session) parts.push(run.session);
  if (run.distanceKm !== undefined && run.distanceKm > 0) {
    parts.push(`${Math.round(run.distanceKm * 10) / 10}km`);
  } else if (run.durationMin !== undefined && run.durationMin > 0) {
    parts.push(`${run.durationMin}分`);
  }
  const pace = run.metrics?.avgPace;
  if (pace) parts.push(pace);

  const body = parts.join('・');
  return body ? `${whenWord(days)}の${body}。` : `${whenWord(days)}、走っていますね。`;
}

/**
 * 挨拶を1つ作る。
 *
 * @param now テストから時刻を差し込めるようにしておく。
 *   **「今日」が変わるところで結果が変わるので、固定できないと確かめられない。**
 */
export function greetingFor(profile: RunnerProfile, now: Date = new Date()): Greeting {
  const voice = findCharacter(profile.characterId).greet;
  const today = coachDate(now);
  const say = (kind: GreetingKind, ...parts: (string | undefined)[]): Greeting => ({
    kind,
    text: parts.filter((part): part is string => Boolean(part)).join(' '),
  });

  // まだ何も無い。**ここで近況を語り出しても、語る材料が無い。**
  if (profile.activities.length === 0) return say('empty', voice.empty);

  // 痛み。どのコーチでも、ここから入る。
  const safety = assessSafety(profile, now);
  if (safety.runningForbidden) {
    const pain = safety.activePains[0];
    const since = pain.since ? daysBetween(pain.since, today) : undefined;
    const fact =
      since !== undefined && since >= 1 ? `${pain.site}、${since}日目です。` : `${pain.site}ですね。`;
    return say('pain', fact, voice.pain);
  }

  const run = latestRun(profile);
  const away = run ? daysBetween(run.date, today) : undefined;

  // 本番が目前。この時期は、練習1本の話より日数の話。
  const race = upcomingRaces(profile, now)[0];
  const until = race ? daysUntil(race.date, now) : undefined;
  if (race && until !== undefined && until <= RACE_NEAR_DAYS) {
    const fact = until === 0 ? `${race.name}、今日ですね。` : `${race.name}まで${until}日です。`;
    return say('race', voice.hello, fact, voice.ask);
  }

  // しばらく来ていない。**責めない。** 戻ってきたことのほうが重い。
  if (away !== undefined && away >= AWAY_DAYS) {
    return say('back', voice.back, `前に走ってから${away}日空いています。`, voice.ask);
  }

  // いちばん多い場面。この前の練習を、見ていたと分かる形で言う。
  if (run && away !== undefined && away <= RECENT_DAYS) {
    return say('recent', voice.hello, runFact(run, away), voice.ask);
  }

  if (race && until !== undefined && until <= RACE_FAR_DAYS) {
    return say('race', voice.hello, `${race.name}まで${until}日です。`, voice.ask);
  }

  // 靴。急ぎではないが、黙っていると、ある日いきなり痛みになって出てくる。
  const worn = shoeStatuses(profile).find((status) => status.level !== 'ok');
  if (worn) {
    const fact =
      worn.level === 'over'
        ? `${worn.shoe.name}が${Math.round(worn.shoe.km)}km。替えどきを過ぎています。`
        : `${worn.shoe.name}が${Math.round(worn.shoe.km)}km。そろそろです。`;
    return say('shoes', voice.hello, fact, voice.ask);
  }

  return say('plain', voice.hello, voice.ask);
}
