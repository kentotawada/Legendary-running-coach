import { describe, expect, it } from 'vitest';
import { alreadySentToday, markNotified, notifyHourOf, nudgeFor, timeToNotify } from '@/lib/nudge';
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
