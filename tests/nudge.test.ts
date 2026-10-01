import { describe, expect, it } from 'vitest';
import {
  ARRIVAL_TAG,
  alreadySentToday,
  arrivalNudge,
  markNotified,
  notifyHourOf,
  nudgeFor,
  nudgeStatus,
  timeToNotify,
} from '@/lib/nudge';
import { addRace, addShoes, applyProfileUpdate, addActivity, upsertPain } from '@/lib/profile';
import { createDefaultProfile } from '@/lib/types';
import type { RunnerProfile } from '@/lib/types';

// 2026-09-24 は木曜日。日曜の判定を混ぜないため、あえて平日を基準にする。
const NOW = new Date('2026-09-24T09:00:00Z');
const SUNDAY = new Date('2026-09-27T09:00:00Z');
const base = () => createDefaultProfile('u1', NOW.toISOString());

function withGoal(profile: RunnerProfile = base()): RunnerProfile {
  return applyProfileUpdate(
    profile,
    { bodyWeightKg: 62, goal: { kind: 'time', summary: 'サブ3.5', targetTime: '3:30:00' } },
    NOW,
  );
}

/** 「最近ちゃんと記録している人」を作る。静かな日の通知を混ぜないため。 */
function active(profile: RunnerProfile, date = '2026-09-23'): RunnerProfile {
  return addActivity(profile, { date, type: 'run', distanceKm: 10 }, NOW);
}

describe('声のかけどころ', () => {
  it('何も無ければ、何も送らない（無いのが普通）', () => {
    expect(nudgeFor(active(base()), NOW)).toBeNull();
  });

  it('本番の朝は、それだけを送る', () => {
    const profile = active(
      addRace(withGoal(), { name: '東京マラソン', date: '2026-09-24', distance: 'フル', priority: 'A' }, NOW),
    );
    const nudge = nudgeFor(profile, NOW)!;

    expect(nudge.tag).toBe('race-day');
    expect(nudge.title).toContain('東京マラソン');
    expect(nudge.body).toContain('前半を抑えて');
  });

  it('本番3日前は、補給の本数まで言う', () => {
    const profile = active(
      addRace(withGoal(), { name: '東京マラソン', date: '2026-09-27', distance: 'フル', priority: 'A' }, NOW),
    );
    const nudge = nudgeFor(profile, NOW)!;

    expect(nudge.tag).toBe('race-soon');
    expect(nudge.title).toContain('あと3日');
    expect(nudge.body).toContain('ジェル6本');
  });

  it('本番2週間前は、焦りを先回りして肯定する', () => {
    const profile = active(
      addRace(withGoal(), { name: '本番', date: '2026-10-05', distance: 'フル', priority: 'A' }, NOW),
    );
    expect(nudgeFor(profile, NOW)!.body).toContain('焦りは、出て当たり前');
  });

  it('靴が寿命を超えていたら、脚に出る前に知らせる', () => {
    const profile = active(addShoes(base(), { name: 'ゲルカヤノ31', km: 760 }, NOW));
    const nudge = nudgeFor(profile, NOW)!;

    expect(nudge.tag).toBe('shoes');
    expect(nudge.title).toContain('760km');
    expect(nudge.body).toContain('脚の張りが出る前に');
  });

  it('痛みが2週間続いたら、受診という選択肢を出す', () => {
    const profile = active(
      upsertPain(base(), { site: '右膝の外側', severity: 2, status: 'active', since: '2026-09-01' }, NOW),
    );
    const nudge = nudgeFor(profile, NOW)!;

    expect(nudge.tag).toBe('pain');
    expect(nudge.body).toContain('走れる体を残すための受診');
  });

  it('しばらく記録が無い人を、責めない', () => {
    const profile = active(base(), '2026-09-18');
    const nudge = nudgeFor(profile, NOW)!;

    expect(nudge.tag).toBe('quiet');
    expect(nudge.body).toContain('走れていなくても大丈夫');
    // 「3日走っていません」のような催促を混ぜない
    expect(`${nudge.title}${nudge.body}`).not.toMatch(/サボ|走りましょう|続けましょう/);
  });

  it('日曜には、今週の距離をふりかえる', () => {
    const profile = addActivity(base(), { date: '2026-09-25', type: 'run', distanceKm: 18.4 }, SUNDAY);
    const nudge = nudgeFor(profile, SUNDAY)!;

    expect(nudge.tag).toBe('weekly');
    expect(nudge.title).toContain('18km');
  });

  it('本番が近い時は、靴より本番を優先する', () => {
    let profile = active(
      addRace(withGoal(), { name: '本番', date: '2026-09-26', distance: 'フル', priority: 'A' }, NOW),
    );
    profile = addShoes(profile, { name: 'A', km: 900 }, NOW);
    expect(nudgeFor(profile, NOW)!.tag).toBe('race-soon');
  });
});

describe('送りすぎない', () => {
  it('1日に2通目は送らない', () => {
    const profile = markNotified(active(addShoes(base(), { name: 'A', km: 900 }, NOW)), 'shoes', NOW);
    expect(alreadySentToday(profile, NOW)).toBe(true);
    expect(nudgeFor(profile, NOW)).toBeNull();
  });

  it('同じ知らせは、間を空けるまで出さない', () => {
    const profile = markNotified(active(addShoes(base(), { name: 'A', km: 900 }, NOW)), 'shoes', NOW);
    const tomorrow = new Date('2026-09-25T09:00:00Z');

    expect(alreadySentToday(profile, tomorrow)).toBe(false);
    // 靴の知らせは2週間おき。翌日にもう一度は出さない。
    expect(nudgeFor(profile, tomorrow)).toBeNull();
  });

  it('間が空けば、また出す', () => {
    const profile = markNotified(active(addShoes(base(), { name: 'A', km: 900 }, NOW), '2026-10-10'), 'shoes', NOW);
    const later = new Date('2026-10-12T09:00:00Z');
    expect(nudgeFor(profile, later)?.tag).toBe('shoes');
  });

  it('別の知らせなら、間を空けていなくても出せる', () => {
    let profile = active(
      addRace(withGoal(), { name: '本番', date: '2026-09-26', distance: 'フル', priority: 'A' }, NOW),
    );
    profile = markNotified(profile, 'shoes', new Date('2026-09-23T09:00:00Z'));
    expect(nudgeFor(profile, NOW)?.tag).toBe('race-soon');
  });
});

describe('受け取る時刻', () => {
  const jst = (hour: number) => new Date(`2026-09-28T${String(hour).padStart(2, '0')}:05:00+09:00`);

  const ready = (over: Partial<RunnerProfile> = {}): RunnerProfile =>
    ({
      ...base(),
      shoes: [
        { id: 's', name: 'ペガサス 40', role: 'daily', km: 900, updatedAt: '2026-09-01T00:00:00.000Z' },
      ],
      ...over,
    }) as RunnerProfile;

  it('決めていなければ、朝9時', () => {
    expect(notifyHourOf(ready())).toBe(9);
  });

  it('決めた時刻を、そのまま使う', () => {
    expect(notifyHourOf(ready({ notifications: { hour: 20 } }))).toBe(20);
  });

  it('おかしな値は、既定に落とす', () => {
    expect(notifyHourOf(ready({ notifications: { hour: 99 } }))).toBe(9);
    expect(notifyHourOf(ready({ notifications: { hour: -3 } }))).toBe(9);
  });

  /** **決めた時刻より前には送らない。** 朝が全員に良い時間とは限らない。 */
  it('決めた時刻より前は、送らない', () => {
    const night = ready({ notifications: { hour: 20 } });
    expect(timeToNotify(night, jst(9))).toBe(false);
    expect(nudgeFor(night, jst(9))).toBeNull();
  });

  it('決めた時刻になれば、送る', () => {
    const night = ready({ notifications: { hour: 20 } });
    expect(timeToNotify(night, jst(20))).toBe(true);
    expect(nudgeFor(night, jst(20))).not.toBeNull();
  });

  /**
   * **過ぎていれば送る。** 定期実行が1日1回しか回らない設定でも、
   * 時刻を決めた人が黙って受け取れなくなることがないように。
   */
  it('時刻を過ぎていても、その日のうちなら送る', () => {
    expect(timeToNotify(ready({ notifications: { hour: 7 } }), jst(11))).toBe(true);
  });

  it('時刻を決めていても、今日すでに送っていれば送らない', () => {
    const sent = ready({
      notifications: { hour: 7, lastSentAt: jst(7).toISOString() },
    });
    expect(nudgeFor(sent, jst(11))).toBeNull();
  });
});

/**
 * 「来なかった」の中身。
 *
 * **送る用事が無かっただけなのか、どこかで止まっているのか。**
 * 外からは同じ「来ない」に見えるので、理由を言える形にしておく。
 */
describe('なぜ今日は送らないのか', () => {
  it('知らせる用事が無い（いちばん多く、これは正常）', () => {
    const status = nudgeStatus(active(base()), NOW);
    expect(status.nudge).toBeNull();
    expect(status.skip).toBe('nothing-to-say');
  });

  it('決めた時刻より前', () => {
    // 9時に受け取る設定の人を、朝6時に見る。
    const profile = applyProfileUpdate(active(base()), {}, NOW);
    const at9 = { ...profile, notifications: { ...(profile.notifications ?? {}), hour: 9 } };
    const status = nudgeStatus(at9, new Date('2026-09-24T06:00:00+09:00'));
    expect(status.skip).toBe('too-early');
  });

  it('今日はもう送った', () => {
    const profile = markNotified(active(base()), 'quiet', NOW);
    expect(nudgeStatus(profile, NOW).skip).toBe('sent-today');
  });

  /** 用事はあるが、最近送ったばかり。**用事が無いのとは、次にすることが違う。** */
  it('最近同じことを送ったばかり', () => {
    const raceDay = addRace(
      withGoal(),
      { name: '東京マラソン', date: '2026-09-24', distance: 'フル', priority: 'A' },
      NOW,
    );
    // 本番当日の知らせを、昨日のうちに送ってしまった形にする。
    const yesterday = new Date(NOW.getTime() - 86_400_000);
    const sent = markNotified(active(raceDay), 'race-day', yesterday);
    // 「今日はもう送った」には当たらないが、その用事は冷却中。
    expect(alreadySentToday(sent, NOW)).toBe(false);
    expect(nudgeStatus(sent, NOW).skip).toBe('on-cooldown');
  });

  it('送る時は、理由が付かない', () => {
    const profile = active(
      addRace(withGoal(), { name: '東京マラソン', date: '2026-09-24', distance: 'フル', priority: 'A' }, NOW),
    );
    const status = nudgeStatus(profile, NOW);
    expect(status.skip).toBeNull();
    expect(status.nudge?.tag).toBe('race-day');
  });

  it('nudgeFor と、同じ判断になる', () => {
    const scenes = [
      active(base()),
      markNotified(active(base()), 'quiet', NOW),
      active(addRace(withGoal(), { name: '大会', date: '2026-09-24', priority: 'A' }, NOW)),
    ];
    for (const scene of scenes) {
      expect(nudgeFor(scene, NOW)).toEqual(nudgeStatus(scene, NOW).nudge);
    }
  });
});

/**
 * 「1日に1通」は、日付で数える。
 *
 * 以前は「24時間以内に送ったか」で見ていた。定期実行の時刻は毎回少しずれるので、
 * 昨日 9:45 に送って今日 9:10 に回ると23時間25分しか空いておらず、今日の1通が止まった。
 */
describe('1日1通の数え方', () => {
  const at = (iso: string) => new Date(iso);
  const sentAt = (iso: string) => markNotified(active(base()), 'quiet', at(iso));

  it('昨日の遅い時刻に送っていても、今朝は送れる', () => {
    const profile = sentAt('2026-09-23T09:45:00+09:00');
    expect(alreadySentToday(profile, at('2026-09-24T09:10:00+09:00'))).toBe(false);
  });

  it('昨夜送っていても、今朝は送れる', () => {
    const profile = sentAt('2026-09-23T21:30:00+09:00');
    expect(alreadySentToday(profile, at('2026-09-24T09:05:00+09:00'))).toBe(false);
  });

  it('今朝送ったなら、今日の昼にはもう送らない', () => {
    const profile = sentAt('2026-09-24T05:10:00+09:00');
    expect(alreadySentToday(profile, at('2026-09-24T12:00:00+09:00'))).toBe(true);
  });

  it('記録が壊れていても、止めずに送れる側に倒す', () => {
    const base0 = active(base());
    const broken = { ...base0, notifications: { lastSentAt: 'not-a-date' } };
    expect(alreadySentToday(broken, NOW)).toBe(false);
  });
});


/**
 * 走り終えた直後の一言。
 *
 * 定期の声かけと違い、**向こうから記録が届いた、その瞬間**に出る。
 * 届いたことを知らせるだけでは受領通知でしかないので、
 * 過去の自分との比較まで入って初めて、開く理由になる。
 */
describe('届いた直後の一言', () => {
  const ARRIVED = new Date('2026-09-24T08:30:00+09:00');

  /** 今日の20km。1か月以上前の似た練習より速い。 */
  function ran(): RunnerProfile {
    const past = [60, 75, 90].map((ago) => {
      const date = new Date(ARRIVED.getTime() - ago * 86400000).toISOString().slice(0, 10);
      return {
        id: `p${ago}`,
        date,
        type: 'run' as const,
        distanceKm: 20,
        durationMin: 114,
        metrics: { avgHr: 152 },
        createdAt: `${date}T10:00:00.000Z`,
      };
    });
    return {
      ...base(),
      displayName: '健太',
      characterId: 'logic',
      activities: [...past].sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  const today = {
    id: 'now',
    date: '2026-09-24',
    type: 'run' as const,
    distanceKm: 20,
    durationMin: 110,
    metrics: { avgPace: '5:30/km', avgHr: 148 },
    createdAt: '2026-09-24T08:30:00.000Z',
  };

  it('距離をねぎらって、過去の自分と比べた一言を添える', () => {
    const profile = ran();
    const nudge = arrivalNudge({ ...profile, activities: [...profile.activities, today] }, today, ARRIVED)!;

    expect(nudge.tag).toBe(ARRIVAL_TAG);
    expect(nudge.title).toBe('20km、おつかれさまでした');
    expect(nudge.body).toContain('5:30/km');
    expect(nudge.body).toContain('心拍148');
    expect(nudge.body).toContain('同じくらいの距離の前より');
  });

  it('比べる相手がいなければ、中身を見たことだけを伝える', () => {
    const profile = { ...base(), activities: [today] };
    const nudge = arrivalNudge(profile, today, ARRIVED)!;

    expect(nudge.body).toContain('区間ごとの読み');
    expect(nudge.body).not.toContain('前より');
  });

  it('走っていない記録には出さない', () => {
    const stretch = { ...today, type: 'stretch' as const, distanceKm: undefined };
    expect(arrivalNudge(base(), stretch, ARRIVED)).toBeNull();
    expect(arrivalNudge(base(), { ...today, distanceKm: undefined }, ARRIVED)).toBeNull();
  });

  /** 原則1は定期の声かけと同じ。**1日に2通目が来た時点で、人は設定を切りに行く。** */
  it('今日もう1通送っていれば、出さない', () => {
    const profile = markNotified(base(), 'quiet', new Date('2026-09-24T07:00:00+09:00'));
    expect(arrivalNudge(profile, today, ARRIVED)).toBeNull();
  });

  /** 深夜の取り込みで、枕元を光らせない。 */
  it('深夜には鳴らさない', () => {
    expect(arrivalNudge(base(), today, new Date('2026-09-24T03:00:00+09:00'))).toBeNull();
  });
});

describe('送ったことの記録', () => {
  /**
   * **本人が選んだ受け取り時刻を、送信の記録で潰さない。**
   * ここを上書きしていたので、21時に設定した人が最初の1通のあと朝9時に戻っていた。
   */
  it('受け取る時刻の設定を残す', () => {
    const profile = { ...base(), notifications: { hour: 21 } };
    const after = markNotified(profile, 'quiet', NOW);

    expect(after.notifications?.hour).toBe(21);
    expect(after.notifications?.lastTag).toBe('quiet');
    expect(notifyHourOf(after)).toBe(21);
  });
});
