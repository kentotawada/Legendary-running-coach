import { describe, expect, it } from 'vitest';
import { checklistDoctrine, raceChecklistFor, resolveChecklistBlocks } from '@/lib/checklist';
import { addRace, addShoes, applyProfileUpdate, upsertPain } from '@/lib/profile';
import { createDefaultProfile } from '@/lib/types';
import type { RunnerProfile } from '@/lib/types';
import { parseRichText } from '@/lib/richtext';

const NOW = new Date('2026-09-24T09:00:00Z');
const base = () => createDefaultProfile('u1', NOW.toISOString());

function runner(options: { targetTime?: string; raceDate?: string; distance?: string } = {}): RunnerProfile {
  const profile = applyProfileUpdate(
    base(),
    {
      bodyWeightKg: 62,
      weeklyVolumeKm: 60,
      goal: { kind: 'time', summary: 'サブ3.5', targetTime: options.targetTime ?? '3:30:00' },
    },
    NOW,
  );
  return addRace(
    profile,
    {
      name: '東京マラソン',
      date: options.raceDate ?? '2026-10-04',
      distance: options.distance ?? 'フル',
      priority: 'A',
    },
    NOW,
  );
}

function sectionOf(profile: RunnerProfile, title: string) {
  return raceChecklistFor(profile, NOW)!.sections.find((section) => section.title === title);
}

describe('本番の持ち物', () => {
  it('大会が無ければ、一般的なリストを作らない', () => {
    expect(raceChecklistFor(base(), NOW)).toBeNull();
    expect(checklistDoctrine(base(), NOW)).toBeNull();
  });

  it('終わった大会では作らない', () => {
    const past = runner({ raceDate: '2026-09-01' });
    expect(raceChecklistFor(past, NOW)).toBeNull();
  });

  it('ジェルの本数は、補給計画の計算結果と同じ', () => {
    const fuel = sectionOf(runner(), '補給（計算済み）')!;
    expect(fuel.items[0].label).toBe('ジェル 6本');
    expect(fuel.items[1].detail).toContain('186mg'); // 体重62kg × 3mg
  });

  it('レース用シューズを登録していれば、走行距離で状態を言う', () => {
    const profile = addShoes(runner(), { name: 'アルファフライ', role: 'race', km: 40 }, NOW);
    const shoes = sectionOf(profile, 'シューズと身につける物')!;
    expect(shoes.items[0].label).toContain('アルファフライ');
    expect(shoes.items[0].detail).toContain('40km');
  });

  it('本番が初おろしになる靴は、そう言う', () => {
    const profile = addShoes(runner(), { name: 'アルファフライ', role: 'race', km: 0 }, NOW);
    expect(sectionOf(profile, 'シューズと身につける物')!.items[0].detail).toContain('初おろし');
  });

  it('登録が無ければ、当日履く靴を決めさせる', () => {
    expect(sectionOf(runner(), 'シューズと身につける物')!.items[0].label).toBe('当日履く靴を決める');
  });

  it('入りのペースは、目標より少しだけ遅い値を出す', () => {
    const morning = sectionOf(runner(), '当日の朝')!;
    const pace = morning.items.find((item) => item.label.includes('入りのペース'))!;
    expect(pace.detail).toContain('4:58/km'); // 目標 4:53/km + 5秒
  });

  it('痛みがあれば、止める判断を必ず入れる', () => {
    const profile = upsertPain(runner(), { site: '右膝', severity: 2, status: 'active' }, NOW);
    const morning = sectionOf(profile, '当日の朝')!;
    expect(morning.items.some((item) => item.label.includes('右膝'))).toBe(true);
    expect(JSON.stringify(morning)).toContain('来年も走れる体の方が重い');
  });

  it('レース週は、今から練習を足させない', () => {
    const profile = runner({ raceDate: '2026-09-27' });
    const avoid = raceChecklistFor(profile, NOW)!.sections.at(-1)!;
    expect(JSON.stringify(avoid)).toContain('走力は上がらない');
  });
});

describe('本文への差し込み', () => {
  it('空のブロックが、この人のリストに変わる', () => {
    const text = '持ち物をまとめました。\n```checklist\n{}\n```\n当日の朝にもう一度見てください。';
    const resolved = resolveChecklistBlocks(text, runner(), NOW);
    const block = parseRichText(resolved).find((entry) => entry.type === 'checklist') as {
      race: string;
      daysLeft?: number;
      sections: { title: string }[];
    };

    expect(block.race).toBe('東京マラソン');
    expect(block.daysLeft).toBe(10);
    expect(block.sections.length).toBeGreaterThanOrEqual(4);
    expect(resolved).toContain('当日の朝にもう一度見てください。');
  });

  it('大会が無ければ、ブロックごと消える', () => {
    const text = '準備しましょう。\n\n```checklist\n{}\n```\n\nまた聞かせてください。';
    const resolved = resolveChecklistBlocks(text, base(), NOW);

    expect(resolved).not.toContain('checklist');
    expect(resolved).toContain('準備しましょう。');
    expect(resolved).toContain('また聞かせてください。');
  });

  it('モデルが自分で書いたリストは、計算結果で作り直す', () => {
    const invented =
      '```checklist\n' +
      JSON.stringify({ race: '東京マラソン', sections: [{ title: '補給', items: [{ label: 'ジェル 12本' }] }] }) +
      '\n```';
    const resolved = resolveChecklistBlocks(invented, runner(), NOW);

    expect(resolved).not.toContain('ジェル 12本');
    expect(resolved).toContain('ジェル 6本');
  });

  it('差し替え済みの本文は、読み直しても変わらない', () => {
    const once = resolveChecklistBlocks('```checklist\n{}\n```', runner(), NOW);
    expect(resolveChecklistBlocks(once, base(), NOW)).toBe(once);
  });

  it('本番が近ければ、一度は渡すよう促す', () => {
    expect(checklistDoctrine(runner({ raceDate: '2026-10-01' }), NOW)).toContain('一度渡しておくこと');
  });

  it('まだ先なら、毎回出させない', () => {
    const text = checklistDoctrine(runner({ raceDate: '2026-12-20' }), NOW)!;
    expect(text).toContain('毎回出さない');
    expect(text).not.toContain('一度渡しておくこと');
  });
});
