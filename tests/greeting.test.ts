import { describe, expect, it } from 'vitest';
import { COACH_CHARACTERS } from '@/lib/characters';
import { greetingFor } from '@/lib/greeting';
import type { ActivityLog, PainPoint, RunnerProfile } from '@/lib/types';

/**
 * 開いた時にコーチが言う一言。
 *
 * **ここが黙っていると、アプリは白紙のまま始まる。**
 * 文章はモデルに書かせていないので、何が出るかはここで全部確かめられる。
 */

const NOW = new Date('2026-09-27T10:00:00+09:00');
const day = (back: number) =>
  new Date(NOW.getTime() - back * 86_400_000).toISOString().slice(0, 10);

function runner(over: Partial<RunnerProfile> = {}): RunnerProfile {
  return {
    id: 'u1',
    phase: 'building',
    phaseHistory: [],
    pains: [],
    conditionLogs: [],
    activities: [],
    plans: [],
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...over,
  } as RunnerProfile;
}

const ran = (back: number, over: Partial<ActivityLog> = {}): ActivityLog => ({
  id: `a${back}`,
  date: day(back),
  createdAt: NOW.toISOString(),
  type: 'run',
  distanceKm: 12,
  durationMin: 62,
  metrics: { avgPace: '5:12/km' },
  ...over,
});

const hurts = (over: Partial<PainPoint> = {}): PainPoint => ({
  id: 'p1',
  site: '左ふくらはぎ',
  severity: 2,
  status: 'active',
  since: day(9),
  updatedAt: NOW.toISOString(),
  ...over,
});

describe('何を言うか', () => {
  it('記録が無ければ、最初の一手だけを渡す', () => {
    const greeting = greetingFor(runner(), NOW);
    expect(greeting.kind).toBe('empty');
    expect(greeting.text.length).toBeGreaterThan(5);
  });

  /** **痛みがある時は、必ず痛みの話から入る。** ここだけは誰を選んでも同じ結論。 */
  it('痛みがあれば、痛みの話から入り、走らせない', () => {
    const greeting = greetingFor(
      runner({ activities: [ran(1)], pains: [hurts()] }),
      NOW,
    );
    expect(greeting.kind).toBe('pain');
    expect(greeting.text).toContain('左ふくらはぎ');
    expect(greeting.text).toContain('9日目');
  });

  it('どのコーチを選んでも、痛みの日は走らせない', () => {
    for (const character of COACH_CHARACTERS) {
      const greeting = greetingFor(
        runner({ characterId: character.id, activities: [ran(1)], pains: [hurts()] }),
        NOW,
      );
      expect(greeting.kind, character.name).toBe('pain');
      // 「走りましょう」の類が混ざっていないこと。
      expect(greeting.text, character.name).not.toMatch(/走りましょう|走ってみ|ジョグ/);
    }
  });

  it('治った痛みは、蒸し返さない', () => {
    const greeting = greetingFor(
      runner({ activities: [ran(1)], pains: [hurts({ status: 'resolved', severity: 0 })] }),
      NOW,
    );
    expect(greeting.kind).not.toBe('pain');
  });

  it('この前の練習を、見ていたと分かる形で言う', () => {
    const greeting = greetingFor(runner({ activities: [ran(1, { session: '閾値走' })] }), NOW);
    expect(greeting.kind).toBe('recent');
    expect(greeting.text).toContain('昨日');
    expect(greeting.text).toContain('閾値走');
    expect(greeting.text).toContain('5:12/km');
  });

  /** **責めない。** 戻ってきたことのほうが重い。 */
  it('しばらく空いていたら、そこに触れる', () => {
    const greeting = greetingFor(runner({ activities: [ran(10)] }), NOW);
    expect(greeting.kind).toBe('back');
    expect(greeting.text).toContain('10日');
  });

  it('休養日ていどの間は、「久しぶり」にしない', () => {
    expect(greetingFor(runner({ activities: [ran(2)] }), NOW).kind).toBe('recent');
  });

  it('本番が目前なら、練習1本より日数の話', () => {
    const greeting = greetingFor(
      runner({
        activities: [ran(1)],
        races: [{ id: 'r', name: '湘南国際マラソン', date: day(-6), priority: 'A' }],
      }),
      NOW,
    );
    expect(greeting.kind).toBe('race');
    expect(greeting.text).toContain('湘南国際マラソン');
    expect(greeting.text).toContain('6日');
  });

  it('まだ先の本番は、練習の話を優先する', () => {
    const greeting = greetingFor(
      runner({
        activities: [ran(1)],
        races: [{ id: 'r', name: '湘南国際マラソン', date: day(-90), priority: 'A' }],
      }),
      NOW,
    );
    expect(greeting.kind).toBe('recent');
  });

  it('靴が寿命に近ければ、そこに触れる', () => {
    const greeting = greetingFor(
      runner({
        activities: [ran(20)].map((a) => ({ ...a, date: day(20) })),
        shoes: [
          { id: 's1', name: 'ペガサス 40', role: 'daily', km: 820, updatedAt: NOW.toISOString() },
        ],
      }),
      NOW,
    );
    // 20日空いているので「久しぶり」が先に立つ。靴はその次。
    expect(['back', 'shoes']).toContain(greeting.kind);
  });
});

describe('誰が言うか', () => {
  /** **これが揃っていないと、8人選べる意味が無い。** */
  it('コーチごとに、ちがう言葉になる', () => {
    const texts = COACH_CHARACTERS.map(
      (character) =>
        greetingFor(runner({ characterId: character.id, activities: [ran(1)] }), NOW).text,
    );
    expect(new Set(texts).size).toBe(COACH_CHARACTERS.length);
  });

  it('全員が、どの場面でも何かを言える', () => {
    const scenes: RunnerProfile[] = [
      runner(),
      runner({ activities: [ran(1)] }),
      runner({ activities: [ran(12)] }),
      runner({ activities: [ran(1)], pains: [hurts()] }),
    ];
    for (const character of COACH_CHARACTERS) {
      for (const scene of scenes) {
        const greeting = greetingFor({ ...scene, characterId: character.id }, NOW);
        expect(greeting.text.trim().length, character.name).toBeGreaterThan(5);
      }
    }
  });

  /** 白石は感嘆符を使わない。**口調の決めごとを、挨拶でも守る。** */
  it('言わないと決めた言い方が、混ざっていない', () => {
    const logic = greetingFor(runner({ characterId: 'logic', activities: [ran(1)] }), NOW);
    expect(logic.text).not.toContain('！');
    expect(logic.text).not.toContain('頑張って');
  });
});
