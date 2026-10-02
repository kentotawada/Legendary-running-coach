import { describe, expect, it } from 'vitest';
import { fitnessDoctrine, readFitness, shortTime, timeForVdot } from '@/lib/fitness';
import { estimateVdot } from '@/lib/goals';
import { createDefaultProfile } from '@/lib/types';
import type { ActivityLog, RunnerProfile } from '@/lib/types';

/**
 * 目標に届くのか。
 *
 * **ここは、いちばん嘘をつきやすい場所。**
 * 気の利いたことを言おうとすると、根拠のない「いけます」が出る。
 * 守るのは、材料が無ければ答えないことと、「無理です」と言わないこと。
 */

const NOW = new Date('2026-10-02T07:00:00+09:00');

function dateDaysAgo(days: number): string {
  const d = new Date('2026-10-02T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function run(daysAgo: number, km: number, minutes: number, session?: string): ActivityLog {
  const date = dateDaysAgo(daysAgo);
  return {
    id: `a${daysAgo}-${km}`,
    date,
    type: 'run',
    session,
    distanceKm: km,
    durationMin: minutes,
    createdAt: `${date}T10:00:00.000Z`,
  };
}

function profileOf(activities: ActivityLog[], targetTime?: string): RunnerProfile {
  return {
    ...createDefaultProfile('u1', '2026-06-01T00:00:00.000Z'),
    goal: targetTime ? { kind: 'time', summary: '目標', targetTime } : undefined,
    activities,
  };
}

describe('VDOT から時間を逆算する', () => {
  it('元の記録に戻る', () => {
    // 10kmを45分（2700秒）で走った時の VDOT から、10kmのタイムを戻す。
    const vdot = estimateVdot(10000, 2700)!;
    expect(Math.abs(timeForVdot(10, vdot)! - 2700)).toBeLessThanOrEqual(2);
  });

  it('距離が伸びれば、タイムも伸びる', () => {
    const vdot = estimateVdot(10000, 2700)!;
    expect(timeForVdot(21.0975, vdot)!).toBeGreaterThan(timeForVdot(10, vdot)!);
    expect(timeForVdot(42.195, vdot)!).toBeGreaterThan(timeForVdot(21.0975, vdot)!);
  });

  it('ありえない値では答えない', () => {
    expect(timeForVdot(0, 50)).toBeUndefined();
    expect(timeForVdot(10, 0)).toBeUndefined();
  });
});

describe('時間の書き方', () => {
  /** **「0:01:44」は、差として読めない。** 1時間に満たないものに時間の桁を付けない。 */
  it('差は、分と秒で書く', () => {
    expect(shortTime(104)).toBe('1分44秒');
    expect(shortTime(120)).toBe('2分');
    expect(shortTime(45)).toBe('45秒');
    expect(shortTime(2760)).toBe('46分');
    expect(shortTime(5400)).toBe('1時間30分');
    expect(shortTime(3600)).toBe('1時間');
  });
});

describe('材料が無い時', () => {
  /** **イージーのジョグから力は測れない。** 推測で数字を出すより、黙るほうがいい。 */
  it('ジョグしか無ければ、答えない', () => {
    const jogs = [run(3, 10, 60), run(5, 8, 48), run(7, 12, 72)];
    const read = readFitness(profileOf(jogs, '3:30:00'), NOW);

    expect(read.source).toBe('none');
    expect(read.verdict).toBe('unknown');
    expect(read.predicted).toBeUndefined();
    expect(read.headline).toContain('まだ測れていません');
  });

  it('測るための1本を勧める', () => {
    const read = readFitness(profileOf([run(3, 10, 60)], '3:30:00'), NOW);
    expect(read.next.join('')).toContain('閾値走');
  });

  it('古い記録は、いまの力ではない', () => {
    const old = [run(90, 10, 40, '記録会')];
    expect(readFitness(profileOf(old, '3:30:00'), NOW).source).toBe('none');
  });

  it('目標が無ければ、目標を決めるよう言う', () => {
    const read = readFitness(profileOf([run(5, 10, 40, '記録会')]), NOW);
    expect(read.verdict).toBe('unknown');
    expect(read.headline).toContain('目標を決めると');
    expect(read.from).toBeTruthy();
  });
});

describe('どの記録から読むか', () => {
  /** **大会の記録がいちばん強い。** 本気で出し切った記録だけが、本当の力を示す。 */
  it('大会があれば、大会を使う', () => {
    const read = readFitness(
      profileOf([run(10, 21.0975, 95, 'ハーフマラソン記録会'), run(5, 10, 38, '閾値走')], '3:30:00'),
      NOW,
    );
    expect(read.source).toBe('race');
    expect(read.from!.label).toContain('記録会');
  });

  it('大会が無ければ、いちばん良いポイント練習を使う', () => {
    const read = readFitness(
      profileOf([run(10, 10, 45, '閾値走'), run(5, 10, 40, 'インターバル')], '3:30:00'),
      NOW,
    );
    expect(read.source).toBe('hard');
    expect(read.from!.date).toBe(dateDaysAgo(5));
  });

  /** 練習は本気の出し切りではない。断定させない。 */
  it('練習から出した時は、下限だと書く', () => {
    const read = readFitness(profileOf([run(5, 10, 45, '閾値走')], '3:30:00'), NOW);
    expect(read.detail).toContain('下限');
  });
});

describe('届くかどうかの判定', () => {
  /** サブ3.5（3:30:00）に、10kmを40分で走れる力があれば届く。 */
  const strong = () => profileOf([run(5, 10, 40, '記録会')], '3:30:00');

  it('届いている人には、当日は別だと伝える', () => {
    const read = readFitness(strong(), NOW);

    expect(read.verdict).toBe('reachable');
    expect(read.headline).toContain('速い見込み');
    expect(read.detail).toContain('当日に出せるかは別');
    expect(read.next.join('')).toContain('入りを');
  });

  it('差が大きくても、無理とは言わない', () => {
    // 10kmを60分。サブ3.5には遠い。
    const read = readFitness(profileOf([run(5, 10, 60, '記録会')], '3:30:00'), NOW);

    expect(read.verdict).toBe('far');
    expect(`${read.headline}${read.detail}`).not.toContain('無理');
    expect(read.detail).toContain('届かない、という意味ではありません');
    expect(read.next[0]).toContain('手前に1つ');
  });

  it('差の大きさで、言い方を変える', () => {
    // サブ3.5（3:30:00）を目標に、10kmのタイムを振ったときの見込み。
    //   42分 → 3:13:43 / 46分 → 3:31:44 / 48分 → 3:40:41 / 55分 → 4:11:36
    const verdicts = [
      [42, 'reachable'],
      [46, 'close'],
      [48, 'stretch'],
      [55, 'far'],
    ] as const;
    for (const [minutes, want] of verdicts) {
      const read = readFitness(profileOf([run(5, 10, minutes, '記録会')], '3:30:00'), NOW);
      expect(read.verdict).toBe(want);
    }
  });

  it('いまの力と目標を、並べて出す', () => {
    const read = readFitness(strong(), NOW);
    expect(read.predicted).toMatch(/^\d+:\d\d:\d\d$/);
    expect(read.target).toBe('3:30:00');
  });

  /** 画面に地の文として出す。記号を混ぜない。 */
  it('記号を混ぜない', () => {
    for (const minutes of [42, 46, 48, 55]) {
      const read = readFitness(profileOf([run(5, 10, minutes, '記録会')], '3:30:00'), NOW);
      expect(`${read.headline}${read.detail}${read.next.join('')}`).not.toContain('**');
    }
  });
});

describe('プロンプトに差し込む力の読み', () => {
  it('材料が無い時は、推測させない', () => {
    const text = fitnessDoctrine(profileOf([run(3, 10, 60)], '3:30:00'), NOW)!;
    expect(text).toContain('イージーのジョグから力を推測して答えないこと');
  });

  it('数字と出どころを、固定して渡す', () => {
    const text = fitnessDoctrine(profileOf([run(5, 10, 40, '記録会')], '3:30:00'), NOW)!;

    expect(text).toContain('自分で計算し直さないこと');
    expect(text).toContain('材料:');
    expect(text).toContain('「無理です」と言わないこと');
  });

  it('練習から出した時は、断定させない', () => {
    const text = fitnessDoctrine(profileOf([run(5, 10, 45, '閾値走')], '3:30:00'), NOW)!;
    expect(text).toContain('この記録では無理」と断定しないこと');
  });
});
