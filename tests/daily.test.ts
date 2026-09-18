import { describe, expect, it } from 'vitest';
import { dailyDoctrine, dailyStatus, logWeight, markOpened, streakDays } from '@/lib/daily';
import { createDefaultProfile } from '@/lib/types';
import { addActivity } from '@/lib/profile';

const at = (date: string) => new Date(`${date}T09:00:00`);

describe('markOpened', () => {
  it('開いた日を記録する', () => {
    const profile = markOpened(createDefaultProfile('u1'), at('2026-09-17'));
    expect(profile.dailyLog).toEqual([{ date: '2026-09-17', opened: true }]);
  });

  it('同じ日に何度開いても増えない', () => {
    let profile = markOpened(createDefaultProfile('u1'), at('2026-09-17'));
    const before = profile;
    profile = markOpened(profile, at('2026-09-17'));

    expect(profile).toBe(before);
    expect(profile.dailyLog).toHaveLength(1);
  });
});

describe('streakDays', () => {
  const openDays = (dates: string[]) =>
    dates.reduce((profile, date) => markOpened(profile, at(date)), createDefaultProfile('u1'));

  it('連続して開いた日数を数える', () => {
    const profile = openDays(['2026-09-15', '2026-09-16', '2026-09-17']);
    expect(streakDays(profile, at('2026-09-17'))).toBe(3);
  });

  it('途切れたらそこで止まる', () => {
    const profile = openDays(['2026-09-10', '2026-09-16', '2026-09-17']);
    expect(streakDays(profile, at('2026-09-17'))).toBe(2);
  });

  it('今日まだ開いていなくても、昨日までの連続は消えない', () => {
    // 朝いちばんに開く前でも「0日」と表示されると、続ける気持ちを折る。
    const profile = openDays(['2026-09-15', '2026-09-16']);
    expect(streakDays(profile, at('2026-09-17'))).toBe(2);
  });

  it('2日以上空いたら 0 に戻る', () => {
    const profile = openDays(['2026-09-10']);
    expect(streakDays(profile, at('2026-09-17'))).toBe(0);
  });

  it('記録が無ければ 0', () => {
    expect(streakDays(createDefaultProfile('u1'), at('2026-09-17'))).toBe(0);
  });
});

describe('体重の記録', () => {
  it('はかった体重を残し、最新値をプロフィールにも反映する', () => {
    const profile = logWeight(createDefaultProfile('u1'), 61.4, '2026-09-17', at('2026-09-17'));

    expect(profile.bodyWeightKg).toBe(61.4);
    expect(profile.dailyLog?.[0]).toMatchObject({ date: '2026-09-17', weightKg: 61.4 });
  });

  it('同じ日にはかり直したら上書きする', () => {
    let profile = logWeight(createDefaultProfile('u1'), 61.4, '2026-09-17', at('2026-09-17'));
    profile = logWeight(profile, 61.0, '2026-09-17', at('2026-09-17'));

    expect(profile.dailyLog).toHaveLength(1);
    expect(profile.dailyLog?.[0].weightKg).toBe(61.0);
  });
});

describe('dailyStatus', () => {
  it('開く・はかる・動く の3つをスタンプにする', () => {
    let profile = markOpened(createDefaultProfile('u1'), at('2026-09-17'));
    profile = logWeight(profile, 61.4, '2026-09-17', at('2026-09-17'));
    profile = addActivity(profile, { date: '2026-09-17', type: 'walk', durationMin: 20 }, at('2026-09-17'));

    const status = dailyStatus(profile, at('2026-09-17'));
    expect(status.earned).toBe(3);
    expect(status.stamps.map((s) => s.id)).toEqual(['opened', 'weighed', 'moved']);
  });

  it('完全休養はスタンプにならない（休むことは記録するが、動いた扱いにしない）', () => {
    const profile = addActivity(
      markOpened(createDefaultProfile('u1'), at('2026-09-17')),
      { date: '2026-09-17', type: 'rest' },
      at('2026-09-17'),
    );
    expect(dailyStatus(profile, at('2026-09-17')).stamps[2].done).toBe(false);
  });

  it('節目の日を見つける', () => {
    const dates = Array.from({ length: 7 }, (_, i) => `2026-09-${11 + i}`);
    const profile = dates.reduce((acc, date) => markOpened(acc, at(date)), createDefaultProfile('u1'));

    expect(dailyStatus(profile, at('2026-09-17')).milestone).toBe(7);
  });

  it('節目でない日は祝わない', () => {
    const profile = markOpened(createDefaultProfile('u1'), at('2026-09-17'));
    expect(dailyStatus(profile, at('2026-09-17')).milestone).toBeUndefined();
  });
});

describe('dailyDoctrine', () => {
  it('体重は増減ではなく、はかったことを評価させる', () => {
    const text = dailyDoctrine(createDefaultProfile('u1'), at('2026-09-17'));

    expect(text).toContain('増減そのものを責めない');
    expect(text).toContain('毎回は言わない');
  });

  it('節目の日は、必ず祝うよう指示する', () => {
    const dates = Array.from({ length: 7 }, (_, i) => `2026-09-${11 + i}`);
    const profile = dates.reduce((acc, date) => markOpened(acc, at(date)), createDefaultProfile('u1'));

    expect(dailyDoctrine(profile, at('2026-09-17'))).toContain('7日連続');
  });
});
