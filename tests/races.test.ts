import { describe, expect, it } from 'vitest';
import {
  daysUntil,
  describeRace,
  pastRaces,
  periodFor,
  raceDoctrine,
  racesOf,
  sortRaces,
  targetRace,
  upcomingRaces,
} from '../src/lib/races';
import { addRace, removeRace, replaceRaces, summarizeProfile } from '../src/lib/profile';
import { executeTool } from '../src/lib/tools';
import { createDefaultProfile } from '../src/lib/types';
import type { RunnerProfile } from '../src/lib/types';

const NOW = new Date('2026-09-18T09:00:00+09:00');

function profileWith(partial: Partial<RunnerProfile> = {}): RunnerProfile {
  return { ...createDefaultProfile('runner-01', NOW.toISOString()), ...partial };
}

describe('daysUntil', () => {
  it('その日の0時を基準に数えるので、時刻で1日ずれない', () => {
    expect(daysUntil('2026-09-18', NOW)).toBe(0);
    expect(daysUntil('2026-09-19', NOW)).toBe(1);
    expect(daysUntil('2026-09-17', NOW)).toBe(-1);
  });

  it('夜遅くに開いても当日は当日のまま', () => {
    const lateNight = new Date('2026-09-18T23:50:00+09:00');
    expect(daysUntil('2026-09-18', lateNight)).toBe(0);
  });

  it('読めない日付は undefined', () => {
    expect(daysUntil('', NOW)).toBeUndefined();
    expect(daysUntil('来年の春', NOW)).toBeUndefined();
    expect(daysUntil(undefined, NOW)).toBeUndefined();
  });
});

describe('大会の一覧', () => {
  it('日付順に並べ、日付の無いものは末尾へ回す', () => {
    const sorted = sortRaces([
      { id: '3', name: 'C大会', date: '', priority: 'C' },
      { id: '2', name: 'B大会', date: '2027-03-07', priority: 'B' },
      { id: '1', name: 'A大会', date: '2026-12-06', priority: 'A' },
    ]);
    expect(sorted.map((race) => race.name)).toEqual(['A大会', 'B大会', 'C大会']);
  });

  it('大会を1つしか持てなかった頃の記録も、一覧として読める', () => {
    const profile = profileWith({
      goal: { kind: 'time', summary: 'サブ3', raceName: '東京マラソン', raceDate: '2027-03-07' },
    });
    const races = racesOf(profile);
    expect(races).toHaveLength(1);
    expect(races[0]).toMatchObject({ name: '東京マラソン', date: '2027-03-07', priority: 'A' });
  });

  it('旧データと同じ大会が一覧にあれば、二重に出さない', () => {
    const profile = profileWith({
      goal: { kind: 'time', summary: 'サブ3', raceName: '東京マラソン', raceDate: '2027-03-07' },
      races: [{ id: 'r1', name: '東京マラソン', date: '2027-03-07', priority: 'A' }],
    });
    expect(racesOf(profile)).toHaveLength(1);
  });

  it('終わった大会と、これからの大会を分けて読む', () => {
    const profile = profileWith({
      races: [
        { id: 'r1', name: '春の大会', date: '2026-04-19', priority: 'A' },
        { id: 'r2', name: '秋の大会', date: '2026-11-03', priority: 'B' },
      ],
    });
    expect(upcomingRaces(profile, NOW).map((r) => r.name)).toEqual(['秋の大会']);
    expect(pastRaces(profile, NOW).map((r) => r.name)).toEqual(['春の大会']);
  });
});

describe('仕上げの基準にする大会', () => {
  it('先に来る大会より、Aレースを優先する', () => {
    const profile = profileWith({
      races: [
        { id: 'r1', name: '調整ハーフ', date: '2026-11-03', priority: 'B' },
        { id: 'r2', name: '本命フル', date: '2027-02-28', priority: 'A' },
      ],
    });
    expect(targetRace(profile, NOW)?.name).toBe('本命フル');
  });

  it('Aレースが無ければ、次に来る大会に合わせる', () => {
    const profile = profileWith({
      races: [
        { id: 'r1', name: '12月の大会', date: '2026-12-06', priority: 'B' },
        { id: 'r2', name: '3月の大会', date: '2027-03-07', priority: 'C' },
      ],
    });
    expect(targetRace(profile, NOW)?.name).toBe('12月の大会');
  });

  it('終わった大会は仕上げの対象にならない', () => {
    const profile = profileWith({
      races: [
        { id: 'r1', name: '終わったフル', date: '2026-03-01', priority: 'A' },
        { id: 'r2', name: '次のハーフ', date: '2026-11-03', priority: 'B' },
      ],
    });
    expect(targetRace(profile, NOW)?.name).toBe('次のハーフ');
  });
});

describe('periodFor', () => {
  it('残り日数から、いま積むべき時期が決まる', () => {
    expect(periodFor(200).label).toBe('基礎期');
    expect(periodFor(90).label).toBe('走り込み期');
    expect(periodFor(40).label).toBe('専門期');
    expect(periodFor(14).label).toBe('調整期（テーパー）');
    expect(periodFor(3).label).toBe('レース週');
    expect(periodFor(0).label).toBe('レース当日');
  });

  it('テーパーは強度を残す。距離だけを削らせる', () => {
    expect(periodFor(14).focus).toContain('強度');
    expect(periodFor(14).focus).toContain('落とす');
  });
});

describe('addRace / removeRace / replaceRaces', () => {
  it('大会を足しても、既にある大会を消さない', () => {
    let profile = profileWith();
    profile = addRace(profile, { name: '大会A', date: '2026-11-03' }, NOW);
    profile = addRace(profile, { name: '大会B', date: '2027-02-28', priority: 'B' }, NOW);
    expect(profile.races?.map((r) => r.name)).toEqual(['大会A', '大会B']);
  });

  it('同じ大会を二度登録したら上書きになる', () => {
    let profile = profileWith();
    profile = addRace(profile, { name: '大会A', date: '2026-11-03', priority: 'A' }, NOW);
    profile = addRace(profile, { name: '大会A', date: '2026-11-03', priority: 'B' }, NOW);
    expect(profile.races).toHaveLength(1);
    expect(profile.races?.[0].priority).toBe('B');
  });

  it('旧データの大会は、追加のタイミングで一覧へ移し替える', () => {
    const profile = profileWith({
      goal: { kind: 'time', summary: 'サブ3', raceName: '東京マラソン', raceDate: '2027-03-07' },
    });
    const next = addRace(profile, { name: '調整ハーフ', date: '2026-11-03', priority: 'B' }, NOW);
    expect(next.races?.map((r) => r.name)).toEqual(['調整ハーフ', '東京マラソン']);
    // 二重の情報源を残さない。
    expect(next.goal?.raceName).toBeUndefined();
    expect(next.goal?.raceDate).toBeUndefined();
    expect(next.goal?.summary).toBe('サブ3');
  });

  it('消した大会は戻ってこない', () => {
    let profile = profileWith();
    profile = addRace(profile, { name: '大会A', date: '2026-11-03' }, NOW);
    profile = addRace(profile, { name: '大会B', date: '2027-02-28' }, NOW);
    const id = profile.races!.find((r) => r.name === '大会A')!.id;
    profile = removeRace(profile, id, NOW);
    expect(profile.races?.map((r) => r.name)).toEqual(['大会B']);
  });

  it('一覧ごとの編集は置き換え。消す操作が成立する', () => {
    let profile = profileWith();
    profile = addRace(profile, { name: '大会A', date: '2026-11-03' }, NOW);
    profile = replaceRaces(profile, [{ name: '大会C', date: '2027-01-11', priority: 'C' }], NOW);
    expect(profile.races?.map((r) => r.name)).toEqual(['大会C']);
  });

  it('名前も日付も無い行は落とす', () => {
    const profile = replaceRaces(
      profileWith(),
      [
        { name: '', date: '' },
        { name: '大会A', date: '2026-11-03' },
      ],
      NOW,
    );
    expect(profile.races).toHaveLength(1);
  });
});

describe('add_race ツール', () => {
  it('登録するたびに増え、件数を返す', () => {
    let profile = profileWith();
    const first = executeTool(profile, 'add_race', { name: '大会A', date: '2026-11-03' }, NOW);
    profile = first.profile;
    expect(first.result.ok).toBe(true);
    expect(first.result.raceCount).toBe(1);

    const second = executeTool(
      profile,
      'add_race',
      { name: '大会B', date: '2027-02-28', priority: 'B', distance: 'フル' },
      NOW,
    );
    expect(second.result.raceCount).toBe(2);
    expect(second.profile.races?.map((r) => r.name)).toEqual(['大会A', '大会B']);
    // 複数になった時は、どれが本命かを確かめさせる。
    expect(String(second.result.message)).toContain('本命');
  });

  it('日付が無い、形式が違う場合は受け付けない', () => {
    const profile = profileWith();
    expect(executeTool(profile, 'add_race', { name: '大会A' }, NOW).result.ok).toBe(false);
    expect(executeTool(profile, 'add_race', { name: '大会A', date: '11月3日' }, NOW).result.ok).toBe(false);
  });

  it('未知の優先度は本命として扱う', () => {
    const outcome = executeTool(
      profileWith(),
      'add_race',
      { name: '大会A', date: '2026-11-03', priority: 'S' },
      NOW,
    );
    expect(outcome.profile.races?.[0].priority).toBe('A');
  });

  it('登録していない大会は外せない', () => {
    const outcome = executeTool(profileWith(), 'remove_race', { name: '幻の大会' }, NOW);
    expect(outcome.result.ok).toBe(false);
  });

  it('update_runner_profile で渡された大会も、一覧へ追加される', () => {
    const outcome = executeTool(
      profileWith(),
      'update_runner_profile',
      { goal: { kind: 'time', summary: 'サブ3', raceName: '東京マラソン', raceDate: '2027-03-07' } },
      NOW,
    );
    expect(outcome.profile.races?.map((r) => r.name)).toEqual(['東京マラソン']);
    expect(outcome.profile.goal?.summary).toBe('サブ3');
  });

  it('大会名だけで日付が無ければ、日付を尋ねるよう促す', () => {
    const outcome = executeTool(
      profileWith(),
      'update_runner_profile',
      { goal: { kind: 'time', summary: 'サブ3', raceName: '東京マラソン' } },
      NOW,
    );
    expect(String(outcome.result.message)).toContain('開催日');
  });
});

describe('raceDoctrine', () => {
  it('大会が無ければ何も足さない', () => {
    expect(raceDoctrine(profileWith(), NOW)).toBeNull();
  });

  it('複数の大会があれば、全部並べたうえで本命を名指しする', () => {
    const profile = profileWith({
      races: [
        { id: 'r1', name: '調整ハーフ', date: '2026-11-03', priority: 'B', distance: 'ハーフ' },
        { id: 'r2', name: '本命フル', date: '2027-02-28', priority: 'A', distance: 'フル' },
      ],
    });
    const text = raceDoctrine(profile, NOW)!;
    expect(text).toContain('調整ハーフ');
    expect(text).toContain('本命フル');
    expect(text).toContain('ここに合わせて仕上げる');
    expect(text).toContain('仕上げの対象にしない');
  });

  it('本番までの残り日数から、いまの時期を書き出す', () => {
    const profile = profileWith({
      races: [{ id: 'r1', name: '秋のフル', date: '2026-10-04', priority: 'A' }],
    });
    const text = raceDoctrine(profile, NOW)!;
    expect(text).toContain('あと16日');
    expect(text).toContain('調整期');
  });

  it('フル同士が近すぎる時は、両方を全力で走らせない', () => {
    const profile = profileWith({
      races: [
        { id: 'r1', name: '11月のフル', date: '2026-11-03', priority: 'A', distance: 'フル' },
        { id: 'r2', name: '11月末のフル', date: '2026-11-23', priority: 'B', distance: 'フル' },
      ],
    });
    const text = raceDoctrine(profile, NOW)!;
    expect(text).toContain('20日しかない');
    expect(text).toContain('回復');
  });

  it('フル直後は、走りたがっても回復を優先させる', () => {
    const profile = profileWith({
      races: [{ id: 'r1', name: '先週のフル', date: '2026-09-13', priority: 'A', distance: 'フル' }],
    });
    const text = raceDoctrine(profile, NOW)!;
    expect(text).toContain('5日しか経っていない');
    expect(text).toContain('ポイント練習を入れさせない');
  });

  it('開催日が分からない大会は、日付を尋ねさせる', () => {
    const profile = profileWith({
      goal: { kind: 'time', summary: 'サブ3', raceName: '来春のフル' },
    });
    const text = raceDoctrine(profile, NOW)!;
    expect(text).toContain('来春のフル');
    expect(text).toContain('開催日');
  });
});

describe('カルテへの反映', () => {
  it('出場予定の大会が、残り日数つきで載る', () => {
    const profile = profileWith({
      goal: { kind: 'time', summary: 'サブ3', targetTime: '2:59:59' },
      races: [
        { id: 'r1', name: '調整ハーフ', date: '2026-11-03', priority: 'B' },
        { id: 'r2', name: '本命フル', date: '2027-02-28', priority: 'A' },
      ],
    });
    const summary = summarizeProfile(profile, NOW);
    expect(summary).toContain('出場予定の大会（2件）');
    expect(summary).toContain('調整ハーフ');
    expect(summary).toContain('本命フル');
    expect(summary).toContain('あと46日');
  });

  it('1件を1行にまとめる', () => {
    const line = describeRace(
      { id: 'r1', name: '東京マラソン', date: '2027-03-07', distance: 'フル', targetTime: '2:59:59', priority: 'A' },
      NOW,
    );
    expect(line).toContain('東京マラソン');
    expect(line).toContain('フル');
    expect(line).toContain('目標 2:59:59');
    expect(line).toContain('Aレース');
  });
});
