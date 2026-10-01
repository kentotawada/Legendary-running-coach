import { describe, expect, it } from 'vitest';
import {
  ACUTE_DAYS,
  HIGH_RATIO,
  WATCH_RATIO,
  describeWorkload,
  workloadDoctrine,
  workloadOf,
} from '@/lib/workload';
import { createDefaultProfile } from '@/lib/types';
import type { ActivityLog, RunnerProfile } from '@/lib/types';

/**
 * 積み方が急すぎないか。
 *
 * **走る人が壊れるのは、走りすぎた時ではなく「急に増やした時」。**
 * ここが緩むと、痛くなってから「増やしすぎでしたね」と言う係になる。
 *
 * 守るのは3つ。足りない記録で断定しない、走るなと言わない、増やしたことを責めない。
 */

const NOW = new Date('2026-10-01T09:00:00+09:00');

function dateDaysAgo(days: number): string {
  const d = new Date('2026-10-01T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function run(daysAgo: number, km: number, type: ActivityLog['type'] = 'run'): ActivityLog {
  const date = dateDaysAgo(daysAgo);
  return {
    id: `a${daysAgo}-${km}-${type}`,
    date,
    type,
    distanceKm: km,
    durationMin: Math.round(km * 5.5),
    createdAt: `${date}T10:00:00.000Z`,
  };
}

function profileOf(activities: ActivityLog[]): RunnerProfile {
  return { ...createDefaultProfile('u1'), activities };
}

/** 直前4週を週30km（6日 × 5km）。直近7日は好きな距離で。 */
function built(acuteKm: number): RunnerProfile {
  const past: ActivityLog[] = [];
  for (let day = 7; day < 35; day += 1) {
    if (day % 7 === 0) continue; // 休む日
    past.push(run(day, 5));
  }
  const acute = acuteKm > 0 ? [run(1, acuteKm / 2), run(3, acuteKm / 2)] : [];
  return profileOf([...past, ...acute]);
}

describe('語れるだけの記録があるか', () => {
  it('記録が無ければ、何も言わない', () => {
    expect(workloadOf(profileOf([]), NOW)).toBeNull();
  });

  it('今週走っていなければ、積み方の話はしない', () => {
    expect(workloadOf(built(0), NOW)).toBeNull();
  });

  /** **無いものを割らない。** 土台の4週が無ければ、比はただの大きい数字になる。 */
  it('記録が3週間に満たなければ、比を出さない', () => {
    const young = profileOf([run(1, 10), run(3, 10), run(14, 10)]);
    expect(workloadOf(young, NOW)).toBeNull();
  });

  it('今日の練習も、直近7日に数える', () => {
    const profile = built(0);
    const withToday = profileOf([...profile.activities, run(0, 12)]);
    expect(workloadOf(withToday, NOW)!.acuteKm).toBe(12);
  });

  /** 歩きや自転車は、脚への当たり方が違う。走った分だけを数える。 */
  it('走り以外は数えない', () => {
    const profile = built(0);
    const mixed = profileOf([...profile.activities, run(1, 20, 'walk'), run(2, 15, 'cross'), run(3, 10)]);
    expect(workloadOf(mixed, NOW)!.acuteKm).toBe(10);
  });
});

describe('積み方の判定', () => {
  it('土台どおりなら、警告しない', () => {
    const workload = workloadOf(built(30), NOW)!;
    expect(workload.chronicKm).toBe(30);
    expect(workload.ratio).toBe(1);
    expect(workload.level).toBe('ok');
  });

  it('1.3倍から、少し急ぎ気味', () => {
    const workload = workloadOf(built(30 * WATCH_RATIO), NOW)!;
    expect(workload.ratio).toBe(WATCH_RATIO);
    expect(workload.level).toBe('watch');
  });

  it('1.5倍から、急', () => {
    const workload = workloadOf(built(30 * HIGH_RATIO), NOW)!;
    expect(workload.ratio).toBe(HIGH_RATIO);
    expect(workload.level).toBe('high');
  });

  it('今週これ以内なら急にならない距離を、一緒に出す', () => {
    const workload = workloadOf(built(60), NOW)!;
    expect(workload.safeKm).toBe(39); // 30km × 1.3
    expect(workload.ratio).toBe(2);
  });

  it('直近7日は、ちょうど7日ぶん', () => {
    expect(ACUTE_DAYS).toBe(7);
    const profile = built(0);
    // 7日前は土台の側。直近には入らない。
    const edge = profileOf([...profile.activities, run(6, 8), run(7, 8)]);
    expect(workloadOf(edge, NOW)!.acuteKm).toBe(8);
  });
});

describe('戻ってきた人', () => {
  /** **比を出すと桁外れの数字になるだけ。** 戻し方の話に切り替える。 */
  it('直前4週がほとんど無ければ、比ではなく戻り始めとして見る', () => {
    const profile = profileOf([run(40, 10), run(45, 10), run(2, 14), run(5, 10)]);
    const workload = workloadOf(profile, NOW)!;

    expect(workload.level).toBe('returning');
    expect(workload.ratio).toBeUndefined();
    expect(workload.acuteKm).toBe(24);
  });

  it('戻り始めでも、距離が小さければ何も言わない', () => {
    const profile = profileOf([run(40, 10), run(45, 10), run(2, 4)]);
    expect(workloadOf(profile, NOW)).toBeNull();
  });
});

describe('画面に出す言葉', () => {
  it('無理のない積み方の時は、何も出さない', () => {
    expect(describeWorkload(workloadOf(built(30), NOW)!)).toBeNull();
  });

  it('数字を見せてから、今週の上限を出す', () => {
    const text = describeWorkload(workloadOf(built(60), NOW)!)!;

    expect(text.title).toBe('今週は、積み方が急です');
    expect(text.detail).toContain('直近7日で60km');
    expect(text.detail).toContain('1週あたり30km');
    expect(text.detail).toContain('2倍');
    expect(text.detail).toContain('39kmあたりまで');
  });

  it('少し急ぎ気味の時は、まだ危ないとは言わない', () => {
    const text = describeWorkload(workloadOf(built(40), NOW)!)!;
    expect(text.title).toBe('少し急ぎ気味です');
    expect(text.detail).toContain('まだ危ない数字ではありません');
  });

  it('戻り始めには、戻し方を言う', () => {
    const profile = profileOf([run(40, 10), run(45, 10), run(2, 14), run(5, 10)]);
    const text = describeWorkload(workloadOf(profile, NOW)!)!;
    expect(text.title).toBe('戻ってきたところです');
    expect(text.detail).toContain('2〜3週かけて');
  });

  /** 地の文として出す。`**` が書いてあると、そのまま文字で見える。 */
  it('画面に出す文に、記号を混ぜない', () => {
    for (const km of [40, 60]) {
      const text = describeWorkload(workloadOf(built(km), NOW)!)!;
      expect(`${text.title}${text.detail}`).not.toContain('**');
    }
  });
});

describe('プロンプトに差し込む積み方', () => {
  it('計算済みの数値を載せる', () => {
    const text = workloadDoctrine(built(60), NOW)!;
    expect(text).toContain('自分で足し直さないこと');
    expect(text).toContain('直近7日: 60km');
    expect(text).toContain('1週あたり 30km');
    expect(text).toContain('2倍');
  });

  /**
   * **「走るな」は、痛みがある時の言葉。**
   * ここで使うと、本当に止めなければいけない時の効き目が薄れる。
   */
  it('急な時も、走るなとは言わせない', () => {
    const text = workloadDoctrine(built(60), NOW)!;
    expect(text).toContain('39km あたりまでに収める');
    expect(text).toContain('走るなとは言わない');
    expect(text).toContain('責めない');
  });

  it('少し急ぎ気味の時は、まだ警告させない', () => {
    const text = workloadDoctrine(built(40), NOW)!;
    expect(text).toContain('まだ警告しない');
  });

  it('無理のない時は、わざわざ褒めさせない', () => {
    const text = workloadDoctrine(built(30), NOW)!;
    expect(text).toContain('わざわざ褒めない');
  });

  it('語れる記録が無ければ、何も載せない', () => {
    expect(workloadDoctrine(profileOf([]), NOW)).toBeNull();
    expect(workloadDoctrine(built(0), NOW)).toBeNull();
  });
});
