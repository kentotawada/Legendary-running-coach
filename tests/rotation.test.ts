import { describe, expect, it } from 'vitest';
import { rotationDoctrine, shoeForToday } from '@/lib/rotation';
import { createDefaultProfile } from '@/lib/types';
import type { RunnerProfile, ShoeEntry } from '@/lib/types';

/**
 * 今日、どの靴で走るか。
 *
 * **1足を毎日履くより、2足を回したほうが故障が少ない。**
 * 理由は単純で、同じ場所に同じ力が毎日かかるのをやめられるから。
 * どの記録アプリも累計距離は出すのに、今日の判断までは運ばない。
 */

const NOW = '2026-10-02T00:00:00.000Z';

function shoe(name: string, km: number, role: ShoeEntry['role'] = 'daily'): ShoeEntry {
  return { id: name, name, role, km, updatedAt: NOW };
}

const profileOf = (shoes: ShoeEntry[], extra: Partial<RunnerProfile> = {}): RunnerProfile => ({
  ...createDefaultProfile('u1', NOW),
  shoes,
  ...extra,
});

describe('どれを履くか', () => {
  /** **同じ靴を続けて履かせない。** 距離の少ないものから回す。 */
  it('いちばん距離の少ない1足を出す', () => {
    const pick = shoeForToday(profileOf([shoe('A', 400), shoe('B', 120), shoe('C', 260)]), 'easy')!;

    expect(pick.shoe!.name).toBe('B');
    expect(pick.why).toContain('いちばん距離が少ない');
  });

  /** **イージーでカーボンを履かせない。** */
  it('ふだんの日に、レース用を出さない', () => {
    const pick = shoeForToday(profileOf([shoe('デイリー', 300), shoe('レース用', 40, 'race')]), 'easy')!;
    expect(pick.shoe!.name).toBe('デイリー');
  });

  it('本番と、強い日にはレース用を出す', () => {
    const shoes = [shoe('デイリー', 300), shoe('レース用', 40, 'race')];
    expect(shoeForToday(profileOf(shoes), 'hard')!.shoe!.name).toBe('レース用');
    expect(shoeForToday(profileOf(shoes), 'easy', { raceSoon: true })!.shoe!.name).toBe('レース用');
  });

  it('役割の合う靴が無ければ、あるもので答える', () => {
    const pick = shoeForToday(profileOf([shoe('デイリー', 300)]), 'hard')!;
    expect(pick.shoe!.name).toBe('デイリー');
  });

  it('走らない日には出さない', () => {
    expect(shoeForToday(profileOf([shoe('A', 100)]), 'rest')).toBeNull();
  });

  it('靴が登録されていなければ、何も言わない', () => {
    expect(shoeForToday(profileOf([]), 'easy')).toBeNull();
  });

  it('引退した靴は出さない', () => {
    const retired = { ...shoe('古いの', 50), retiredAt: '2026-09-01' };
    const pick = shoeForToday(profileOf([retired, shoe('いまの', 300)]), 'easy')!;
    expect(pick.shoe!.name).toBe('いまの');
  });
});

describe('替え時', () => {
  it('目安を超えていたら、はっきり言う', () => {
    const pick = shoeForToday(profileOf([shoe('よく走った', 900)]), 'easy')!;
    expect(pick.caution).toContain('超えています');
    expect(pick.caution).toContain('張りが出る前に');
  });

  it('近づいている時は、近づいているとだけ言う', () => {
    const pick = shoeForToday(profileOf([shoe('そろそろ', 560)]), 'easy')!;
    expect(pick.caution).toContain('替え時が近づいています');
    expect(pick.caution).not.toContain('超えています');
  });

  it('まだ新しければ、何も言わない', () => {
    expect(shoeForToday(profileOf([shoe('おろしたて', 60)]), 'easy')!.caution).toBeUndefined();
  });
});

describe('2足目の提案', () => {
  /** **買わせる話にしない。** 1足の人にだけ、ある程度積んでから一度。 */
  it('1足で、ある程度積んでいる人にだけ出す', () => {
    expect(shoeForToday(profileOf([shoe('1足だけ', 300)]), 'easy')!.suggestSecond).toBeTruthy();
    expect(shoeForToday(profileOf([shoe('おろしたて', 40)]), 'easy')!.suggestSecond).toBeUndefined();
    expect(
      shoeForToday(profileOf([shoe('A', 300), shoe('B', 200)]), 'easy')!.suggestSecond,
    ).toBeUndefined();
  });

  it('理由を添える。買え、とは言わない', () => {
    const text = shoeForToday(profileOf([shoe('1足だけ', 300)]), 'easy')!.suggestSecond!;
    expect(text).toContain('同じ場所に毎回同じ力');
    expect(text).not.toContain('買');
  });
});

describe('画面に出す文字', () => {
  it('記号を混ぜない', () => {
    const pick = shoeForToday(profileOf([shoe('1足だけ', 900)]), 'easy')!;
    expect(`${pick.why}${pick.caution}${pick.suggestSecond}`).not.toContain('**');
  });
});

describe('プロンプトに差し込む1足', () => {
  it('画面に出ている靴を、そのまま知らせる', () => {
    const text = rotationDoctrine(profileOf([shoe('ペガサス', 300)]), 'easy')!;

    expect(text).toContain('ペガサス');
    expect(text).toContain('寿命を断定しないこと');
    expect(text).toContain('買わせる方向に寄せないこと');
  });

  it('提案を出している時は、繰り返させない', () => {
    expect(rotationDoctrine(profileOf([shoe('1足だけ', 300)]), 'easy')).toContain(
      '繰り返し勧めないこと',
    );
  });

  it('靴が無ければ、何も載せない', () => {
    expect(rotationDoctrine(profileOf([]), 'easy')).toBeNull();
  });
});
