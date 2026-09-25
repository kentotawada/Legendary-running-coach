import { describe, expect, it } from 'vitest';
import { analyze, lapTable, runDoctrine } from '@/lib/analysis';
import type { ActivityLap, ActivityLog } from '@/lib/types';

/** 区間を作る。ペースは秒/km。 */
function lap(index: number, km: number, paceSec: number, avgHr?: number): ActivityLap {
  const durationSec = Math.round(paceSec * km);
  const m = Math.floor(paceSec / 60);
  const sec = `${Math.floor(paceSec) % 60}`.padStart(2, '0');
  return { index, distanceKm: km, durationSec, pace: `${m}:${sec}/km`, avgHr };
}

function activity(laps: ActivityLap[]): ActivityLog {
  return {
    id: 'a1',
    date: '2026-09-22',
    type: 'run',
    laps,
    distanceKm: laps.reduce((sum, l) => sum + l.distanceKm, 0),
    createdAt: '2026-09-22T10:00:00.000Z',
  };
}

describe('練習の形を見分ける', () => {
  /**
   * 「1km×4本 + つなぎ3本」は、速い区間のほうが多い。
   * 中央値で切ると速い側に寄ってしまい、速い区間が1本も無いことになる。
   */
  it('本数が偏ったインターバルでも、速い区間を取り違えない', () => {
    const result = analyze(
      activity([
        lap(1, 1, 210, 168),
        lap(2, 0.4, 360, 140),
        lap(3, 1, 212, 172),
        lap(4, 0.4, 365, 142),
        lap(5, 1, 215, 175),
        lap(6, 0.4, 360, 143),
        lap(7, 1, 213, 176),
      ]),
    )!;

    expect(result.shape).toBe('intervals');
    expect(result.reps?.count).toBe(4);
    expect(result.reps?.pace).toBe('3:32/km');
    expect(result.reps?.avgHr).toBe(173);
    expect(result.reps?.restPace).toBe('6:01/km');
  });

  it('一定ペースの走りを、インターバルと言わない', () => {
    const result = analyze(
      activity([lap(1, 1, 300), lap(2, 1, 302), lap(3, 1, 298), lap(4, 1, 305), lap(5, 1, 299)]),
    )!;
    expect(result.shape).toBe('steady');
    expect(result.reps).toBeUndefined();
  });

  /** 一方向に上げていくビルドアップは、速い遅いが行き来しない。 */
  it('ビルドアップを、インターバルと取り違えない', () => {
    const result = analyze(
      activity([lap(1, 1, 330), lap(2, 1, 315), lap(3, 1, 300), lap(4, 1, 285), lap(5, 1, 270)]),
    )!;
    expect(result.shape).toBe('progression');
  });

  it('後半に落ちた走りを、そう呼ぶ', () => {
    const result = analyze(
      activity([lap(1, 1, 280), lap(2, 1, 285), lap(3, 1, 295), lap(4, 1, 305), lap(5, 1, 315)]),
    )!;
    expect(result.shape).toBe('fade');
    expect(result.paceFadeSec).toBeGreaterThan(20);
  });
});

describe('心拍ドリフト', () => {
  /**
   * 同じペースなのに後半の心拍が上がっている＝暑さ・脱水・持久力の不足。
   * 平均心拍だけを見ていると、この差は完全に消える。
   */
  it('同じペースで心拍だけ上がった走りを、数字にする', () => {
    const result = analyze(
      activity([
        lap(1, 1, 300, 145),
        lap(2, 1, 300, 147),
        lap(3, 1, 300, 158),
        lap(4, 1, 300, 162),
      ]),
    )!;

    expect(result.firstHalfHr).toBe(146);
    expect(result.secondHalfHr).toBe(160);
    expect(result.paceFadeSec).toBe(0);
    expect(result.decouplingPercent).toBeGreaterThan(8);
  });

  it('心拍が入っていなければ、ドリフトを名乗らない', () => {
    const result = analyze(activity([lap(1, 1, 300), lap(2, 1, 300), lap(3, 1, 300)]))!;
    expect(result.decouplingPercent).toBeUndefined();
    expect(result.firstHalfHr).toBeUndefined();
  });

  it('区間が1本しか無ければ、何も言わない', () => {
    expect(analyze(activity([lap(1, 10, 300, 150)]))).toBeNull();
  });
});

describe('区間の並べ方', () => {
  it('区間が多い時は間引いて、間引いたことを言う', () => {
    const laps = Array.from({ length: 42 }, (_, i) => lap(i + 1, 1, 300, 150));
    const lines = lapTable(laps);
    expect(lines.length).toBeLessThan(30);
    expect(lines[lines.length - 1]).toContain('42区間');
  });

  it('少ない時は、そのまま全部出す', () => {
    const lines = lapTable([lap(1, 1, 300, 150), lap(2, 1, 295, 155)]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('5:00/km');
    expect(lines[0]).toContain('心拍150');
  });
});

describe('コーチへの渡し方', () => {
  const text = runDoctrine(
    activity([
      lap(1, 1, 210, 168),
      lap(2, 0.4, 360, 140),
      lap(3, 1, 212, 172),
      lap(4, 0.4, 365, 142),
      lap(5, 1, 215, 175),
      lap(6, 0.4, 360, 143),
      lap(7, 1, 213, 176),
    ]),
  )!;

  /** 桁を間違えたまま断定する事故を防ぐ。計算はコードの側で終わらせてある。 */
  it('自分で数え直させない', () => {
    expect(text).toContain('自分で数え直さないこと');
  });

  it('区間・形・速い区間の中身を渡す', () => {
    expect(text).toContain('インターバル');
    expect(text).toContain('速い区間4本');
    expect(text).toContain('3:32/km');
  });

  /** 平均だけを褒めるのは、スクリーンショットでもできる。そこを禁じる。 */
  it('平均だけを褒めさせない', () => {
    expect(text).toContain('平均だけを褒めない');
  });

  it('区間が無い練習には、何も足さない', () => {
    expect(runDoctrine(activity([lap(1, 10, 300, 150)]))).toBeNull();
  });
});
