import { describe, expect, it } from 'vitest';
import {
  SHOE_ROLE_LABEL,
  activeShoes,
  attributeRun,
  findShoe,
  lifespanFor,
  shoeDoctrine,
  shoeStatusOf,
} from '@/lib/shoes';
import { addShoeDistance, addShoes, applyProfileUpdate, retireShoes } from '@/lib/profile';
import { executeTool } from '@/lib/tools';
import { createDefaultProfile } from '@/lib/types';
import type { RunnerProfile } from '@/lib/types';

const NOW = new Date('2026-09-24T09:00:00Z');
const base = () => createDefaultProfile('u1', NOW.toISOString());

function withShoe(profile: RunnerProfile, name: string, km: number, role: 'daily' | 'race' = 'daily') {
  return addShoes(profile, { name, km, role }, NOW);
}

describe('寿命の目安', () => {
  it('レース用は練習用よりずっと短い', () => {
    expect(lifespanFor('race').replace).toBeLessThan(lifespanFor('daily').replace);
  });

  it('体重が重いほど短く、軽いほど長く見る', () => {
    expect(lifespanFor('daily', 80).replace).toBeLessThan(lifespanFor('daily').replace);
    expect(lifespanFor('daily', 50).replace).toBeGreaterThan(lifespanFor('daily').replace);
  });
});

describe('シューズの登録', () => {
  it('すでに履いている距離を引き継いで登録できる', () => {
    const profile = withShoe(base(), 'ゲルカヤノ31', 380);
    expect(activeShoes(profile)[0]).toMatchObject({ name: 'ゲルカヤノ31', km: 380, role: 'daily' });
  });

  it('同じ名前で登録し直しても、2足に増えない', () => {
    const profile = withShoe(withShoe(base(), 'ゲルカヤノ31', 0), 'ゲルカヤノ31', 380);
    expect(activeShoes(profile)).toHaveLength(1);
    expect(activeShoes(profile)[0].km).toBe(380);
  });

  it('引退させると、現役から外れる（記録は残る）', () => {
    const profile = retireShoes(withShoe(base(), 'ゲルカヤノ31', 700), 'ゲルカヤノ31', NOW);
    expect(activeShoes(profile)).toHaveLength(0);
    expect(profile.shoes).toHaveLength(1);
    expect(profile.shoes?.[0].retiredAt).toBe('2026-09-24');
  });

  it('表記が少し違っても同じ靴として引ける', () => {
    const profile = withShoe(base(), 'ゲルカヤノ 31', 100);
    expect(findShoe(profile, 'ゲルカヤノ31')?.km).toBe(100);
  });
});

describe('走った距離をどの足に積むか', () => {
  it('1足しか無ければ、指定が無くてもその足に積む', () => {
    const profile = withShoe(base(), 'ゲルカヤノ31', 100);
    expect(attributeRun(profile, undefined)?.name).toBe('ゲルカヤノ31');
  });

  it('2足あって指定が無ければ、当てずっぽうで積まない', () => {
    const profile = withShoe(withShoe(base(), 'A', 100), 'B', 50);
    expect(attributeRun(profile, undefined)).toBeUndefined();
  });

  it('用途が違えば、そちらの1足に積む', () => {
    const profile = withShoe(withShoe(base(), '練習用A', 100), 'レース用B', 50, 'race');
    expect(attributeRun(profile, undefined, 'race')?.name).toBe('レース用B');
  });
});

describe('log_activity からの積み上げ', () => {
  it('走った距離がシューズに積まれる', () => {
    const profile = withShoe(base(), 'ゲルカヤノ31', 380);
    const { profile: next, result } = executeTool(
      profile,
      'log_activity',
      { type: 'run', distanceKm: 12.5 },
      NOW,
    );

    expect(next.shoes?.[0].km).toBe(392.5);
    // どの靴で走ったかが、その練習の記録にも残る。
    expect(next.activities[0].shoeId).toBe(next.shoes?.[0].id);
    expect(result.ok).toBe(true);
  });

  it('2足あって指定が無ければ、どちらにも積まない', () => {
    const profile = withShoe(withShoe(base(), 'A', 100), 'B', 50);
    const { profile: next } = executeTool(profile, 'log_activity', { type: 'run', distanceKm: 10 }, NOW);
    expect(next.shoes?.map((shoe) => shoe.km).sort((a, b) => a - b)).toEqual([50, 100]);
  });

  it('名前で指定すれば、その足に積む', () => {
    const profile = withShoe(withShoe(base(), 'A', 100), 'B', 50);
    const { profile: next } = executeTool(
      profile,
      'log_activity',
      { type: 'run', distanceKm: 10, shoes: 'B' },
      NOW,
    );
    expect(findShoe(next, 'B')?.km).toBe(60);
  });

  it('目安を越えたら、その場でコーチに伝える', () => {
    const profile = withShoe(base(), 'ゲルカヤノ31', 695);
    const { result } = executeTool(profile, 'log_activity', { type: 'run', distanceKm: 10 }, NOW);
    expect(String(result.shoes)).toContain('目安');
    expect(String(result.shoes)).toContain('買い替えを迫らず');
  });

  it('歩いた距離は積まない', () => {
    const profile = withShoe(base(), 'ゲルカヤノ31', 100);
    const { profile: next } = executeTool(profile, 'log_activity', { type: 'walk', distanceKm: 5 }, NOW);
    expect(next.shoes?.[0].km).toBe(100);
  });
});

describe('いまの状態', () => {
  it('残りの距離と、今のペースでの残り週数を出す', () => {
    const profile = applyProfileUpdate(withShoe(base(), 'A', 600), { weeklyVolumeKm: 50 }, NOW);
    const status = shoeStatusOf(activeShoes(profile)[0], profile);

    expect(status.level).toBe('caution');
    expect(status.remainingKm).toBe(100);
    expect(status.weeksLeft).toBe(2);
  });

  it('2足で回していれば、1足あたりの減りは半分になる', () => {
    let profile = applyProfileUpdate(base(), { weeklyVolumeKm: 50 }, NOW);
    profile = withShoe(withShoe(profile, 'A', 600), 'B', 600);
    expect(shoeStatusOf(activeShoes(profile)[0], profile).weeksLeft).toBe(4);
  });

  it('目安を超えたら、超えた分を出す', () => {
    const profile = withShoe(base(), 'A', 800);
    const status = shoeStatusOf(activeShoes(profile)[0], profile);
    expect(status.level).toBe('over');
    expect(status.remainingKm).toBeLessThan(0);
  });
});

describe('プロンプトに載る形', () => {
  it('登録が無ければ、しつこく聞かせない', () => {
    expect(shoeDoctrine(base(), NOW)).toContain('会話の流れを止めてまで聞かない');
  });

  it('寿命が近い靴は、痛みの相談で真っ先に疑わせる', () => {
    const profile = withShoe(base(), 'ゲルカヤノ31', 680);
    const text = shoeDoctrine(profile, NOW)!;

    expect(text).toContain('ゲルカヤノ31');
    expect(text).toContain('真っ先にここを疑う');
    expect(text).toContain('距離だけを理由に買い替えを迫らない');
  });

  it('週50km以上を1足で回していれば、2足ローテを勧めさせる', () => {
    const profile = applyProfileUpdate(withShoe(base(), 'A', 100), { weeklyVolumeKm: 70 }, NOW);
    expect(shoeDoctrine(profile, NOW)).toContain('2足を交互に');
  });

  it('距離を積んだ靴が分からない練習があれば、尋ねさせる', () => {
    let profile = withShoe(withShoe(base(), 'A', 100), 'B', 50);
    const { profile: logged } = executeTool(profile, 'log_activity', { type: 'run', distanceKm: 10 }, NOW);
    profile = logged;
    expect(shoeDoctrine(profile, NOW)).toContain('どの靴で走ったかが分かっていない');
  });

  it('用途の呼び名は日本語で出す', () => {
    expect(SHOE_ROLE_LABEL.race).toBe('レース用');
  });
});

describe('距離を直接足す', () => {
  it('知らない id には何もしない', () => {
    const profile = withShoe(base(), 'A', 100);
    expect(addShoeDistance(profile, 'nope', 10, NOW)).toBe(profile);
  });

  it('0km や負の距離は無視する', () => {
    const profile = withShoe(base(), 'A', 100);
    expect(addShoeDistance(profile, activeShoes(profile)[0].id, 0, NOW)).toBe(profile);
  });
});
