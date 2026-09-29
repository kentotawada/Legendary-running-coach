import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { loadForSession, setStore, type CoachStore } from '@/lib/store';
import { dedupeActivities } from '@/lib/profile';
import { createDefaultProfile, type ActivityLog, type CoachState, type RunnerProfile } from '@/lib/types';

/**
 * すでに二重に入っている練習を、読み込んだ時にまとめ直す。
 *
 * **入口を直しても、それより前に入った分は残る。**
 * これまでは取り込みの時にしか通していなかったので、
 * その人がもう一度ファイルを取り込むまで直らなかった。
 * 同じ1本が2件あると、その週の走行距離が狂い、コーチの判断まで狂う。
 */

const NOW = '2026-09-30T00:00:00.000Z';

const activity = (over: Partial<ActivityLog>): ActivityLog => ({
  id: over.id ?? 'a',
  date: '2026-09-26',
  type: 'run',
  distanceKm: 21.12,
  durationMin: 85,
  createdAt: NOW,
  ...over,
});

/** チャットで話したほう。**本人の言葉がある。** */
const fromChat = activity({
  id: 'chat',
  session: 'ハーフ試走',
  felt: '夕方、小雨。1時間30分切りを確認でき自信がついた。膝の痛みなし。',
  effort: 8,
});

/** ファイルから取り込んだほう。**区間がある。** */
const fromFile = activity({
  id: 'file',
  laps: Array.from({ length: 22 }, (_, i) => ({ index: i + 1, distanceKm: 1, durationSec: 242 })),
  metrics: { avgPace: '4:02/km', avgHr: 171 },
});

const profileWith = (activities: ActivityLog[]): RunnerProfile => ({
  ...createDefaultProfile('u1', NOW),
  activities,
});

function stubStore(state: CoachState): CoachStore {
  return {
    load: async () => state,
    save: async () => {},
    reset: async () => {},
    adopt: async () => false,
  };
}

afterEach(() => setStore(null));

describe('読み込んだ時に、二重をまとめる', () => {
  beforeEach(() => {
    setStore(stubStore({ profile: profileWith([fromChat, fromFile]), history: [] }));
  });

  it('同じ1本が、1件になる', async () => {
    const state = await loadForSession({ userId: 'u1' });
    expect(state.profile.activities).toHaveLength(1);
  });

  /** **どちらも捨てない。** 時計は感想を測れないし、本人は区間を覚えていない。 */
  it('区間も、本人の言葉も、両方残る', async () => {
    const [merged] = (await loadForSession({ userId: 'u1' })).profile.activities;

    expect(merged.laps).toHaveLength(22);
    expect(merged.metrics?.avgHr).toBe(171);
    expect(merged.session).toBe('ハーフ試走');
    expect(merged.felt).toContain('自信がついた');
    expect(merged.effort).toBe(8);
  });

  it('走行距離が、二重に数えられなくなる', async () => {
    const before = [fromChat, fromFile].reduce((sum, a) => sum + (a.distanceKm ?? 0), 0);
    const after = (await loadForSession({ userId: 'u1' })).profile.activities.reduce(
      (sum, a) => sum + (a.distanceKm ?? 0),
      0,
    );
    expect(before).toBeCloseTo(42.24);
    expect(after).toBeCloseTo(21.12);
  });
});

describe('まとめ方そのもの', () => {
  /** 何度通しても同じ結果。読み込みのたびに通るので、ここが崩れると毎回形が変わる。 */
  it('二度通しても、結果は変わらない', () => {
    const once = dedupeActivities(profileWith([fromChat, fromFile]));
    const twice = dedupeActivities(once);
    expect(twice.activities).toEqual(once.activities);
  });

  it('重複が無ければ、何も作り直さない', () => {
    const profile = profileWith([fromFile]);
    expect(dedupeActivities(profile)).toBe(profile);
  });

  /**
   * **別の練習を、同じものにしない。**
   * 午前と午後に同じ距離を走った日の片方が消えると、
   * 二重に数えるのと同じくらい困る。
   */
  it('日が違えば、別の練習として残す', () => {
    const other = activity({ id: 'other', date: '2026-09-27' });
    expect(dedupeActivities(profileWith([fromFile, other])).activities).toHaveLength(2);
  });

  it('距離が離れていれば、別の練習として残す', () => {
    const other = activity({ id: 'other', distanceKm: 25 });
    expect(dedupeActivities(profileWith([fromFile, other])).activities).toHaveLength(2);
  });

  it('種目が違えば、別の練習として残す', () => {
    const cross = activity({ id: 'cross', type: 'cross' });
    expect(dedupeActivities(profileWith([fromFile, cross])).activities).toHaveLength(2);
  });

  it('3件あっても、1件にまとまる', () => {
    const third = activity({ id: 'third', durationMin: 86 });
    expect(dedupeActivities(profileWith([fromChat, fromFile, third])).activities).toHaveLength(1);
  });

  /** 画面が開いている記録を、足元から差し替えない。 */
  it('先に入っていたほうの id を残す', () => {
    const [merged] = dedupeActivities(profileWith([fromChat, fromFile])).activities;
    expect(merged.id).toBe('chat');
  });
});
