import { describe, expect, it } from 'vitest';
import {
  DAY_START_HOUR,
  coachDate,
  coachWeekday,
  daysBetween,
  shiftDay,
} from '@/lib/day';
import { dailyStatus, markOpened, streakDays } from '@/lib/daily';
import { daysUntil } from '@/lib/races';
import { addRace, today } from '@/lib/profile';
import { createDefaultProfile } from '@/lib/types';

/** 日本時間の瞬間を、サーバーが受け取る形（UTC）で書く。 */
function jst(text: string): Date {
  return new Date(`${text}+09:00`);
}

describe('1日の区切り', () => {
  it('深夜2時に次の日へ変わる', () => {
    expect(coachDate(jst('2026-09-25T01:59:00'))).toBe('2026-09-24');
    expect(coachDate(jst('2026-09-25T02:00:00'))).toBe('2026-09-25');
  });

  it('夜中に走って、1時に記録しても前の日のまま', () => {
    expect(coachDate(jst('2026-09-25T00:30:00'))).toBe('2026-09-24');
    expect(coachDate(jst('2026-09-24T23:50:00'))).toBe('2026-09-24');
  });

  it('朝には変わらない（サーバーのUTCで数えると朝9時に変わってしまう）', () => {
    // 09:00 JST は 00:00 UTC。ここで日付が動いてはいけない。
    expect(coachDate(jst('2026-09-25T08:59:00'))).toBe('2026-09-25');
    expect(coachDate(jst('2026-09-25T09:01:00'))).toBe('2026-09-25');
  });

  it('区切りは2時', () => {
    expect(DAY_START_HOUR).toBe(2);
  });

  it('地域を変えれば、その土地の時刻で切れる', () => {
    // 同じ瞬間でも、ニューヨークではまだ前の日の昼過ぎ。
    const moment = jst('2026-09-25T03:00:00');
    expect(coachDate(moment, 'Asia/Tokyo')).toBe('2026-09-25');
    expect(coachDate(moment, 'America/New_York')).toBe('2026-09-24');
  });

  it('知らない地域名でも止まらない', () => {
    expect(coachDate(jst('2026-09-25T12:00:00'), 'Mars/Olympus')).toBe('2026-09-25');
  });
});

describe('日付の足し算', () => {
  it('月をまたいでも合う', () => {
    expect(shiftDay('2026-09-30', 1)).toBe('2026-10-01');
    expect(shiftDay('2026-10-01', -1)).toBe('2026-09-30');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('日数の差を数える', () => {
    expect(daysBetween('2026-09-24', '2026-09-25')).toBe(1);
    expect(daysBetween('2026-09-24', '2026-09-24')).toBe(0);
    expect(daysBetween('2026-10-04', '2026-09-24')).toBe(-10);
    expect(daysBetween('こわれた', '2026-09-24')).toBeUndefined();
  });

  it('曜日も、その土地の時刻で出す', () => {
    // 2026-09-27 は日曜。
    expect(coachWeekday(jst('2026-09-27T20:00:00'))).toBe(0);
    // 日曜の深夜1時は、まだ土曜の続き。
    expect(coachWeekday(jst('2026-09-27T01:00:00'))).toBe(6);
  });
});

describe('スタンプと連続日数', () => {
  it('深夜1時に開いても、その日のスタンプは前の日に押される', () => {
    const profile = markOpened(createDefaultProfile('u1'), jst('2026-09-25T01:00:00'));
    expect(profile.dailyLog?.[0].date).toBe('2026-09-24');
  });

  it('2時を過ぎたら、新しい日のスタンプになる', () => {
    let profile = markOpened(createDefaultProfile('u1'), jst('2026-09-25T01:00:00'));
    profile = markOpened(profile, jst('2026-09-25T02:30:00'));
    expect(profile.dailyLog?.map((record) => record.date)).toEqual(['2026-09-24', '2026-09-25']);
  });

  it('夜更かしをしても、連続日数が切れない', () => {
    let profile = createDefaultProfile('u1');
    profile = markOpened(profile, jst('2026-09-23T22:00:00'));
    // 日付をまたいだ深夜に開いた分は、24日として数える
    profile = markOpened(profile, jst('2026-09-25T01:30:00'));
    expect(streakDays(profile, jst('2026-09-25T01:40:00'))).toBe(2);
  });

  it('画面に出る日付も、同じ区切りで決まる', () => {
    const status = dailyStatus(createDefaultProfile('u1'), jst('2026-09-25T01:00:00'));
    expect(status.date).toBe('2026-09-24');
    expect(today(jst('2026-09-25T01:00:00'))).toBe('2026-09-24');
  });
});

describe('本番までの日数', () => {
  it('スタンプと同じ区切りで数える', () => {
    const profile = addRace(
      createDefaultProfile('u1'),
      { name: '本番', date: '2026-10-04', priority: 'A' },
      jst('2026-09-24T12:00:00'),
    );
    expect(profile.races?.[0].date).toBe('2026-10-04');
    // 深夜1時は、まだ前の日として数える
    expect(daysUntil('2026-10-04', jst('2026-09-25T01:00:00'))).toBe(10);
    expect(daysUntil('2026-10-04', jst('2026-09-25T02:00:00'))).toBe(9);
  });

  it('当日は0、過ぎていれば負', () => {
    expect(daysUntil('2026-09-25', jst('2026-09-25T06:00:00'))).toBe(0);
    expect(daysUntil('2026-09-20', jst('2026-09-25T06:00:00'))).toBe(-5);
  });
});
