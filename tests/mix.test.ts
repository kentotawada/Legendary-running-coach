import { describe, expect, it } from 'vitest';
import { MIN_RUNS, WINDOW_DAYS, mixDoctrine, paceMix } from '@/lib/mix';
import { createDefaultProfile } from '@/lib/types';
import type { ActivityLog, RunnerProfile } from '@/lib/types';

/**
 * 練習の強弱が、偏っていないか。
 *
 * ここで守りたいのは3つ。
 *  1. **基準は、走れている力から作る。** 届いていない目標から作ると逆の助言になる
 *  2. **材料が足りなければ黙る。** 少ない本数で形を語らない
 *  3. **分かれている人に、余計なことを言わない。** 狼少年になったら誰も読まない
 */

const NOW = new Date('2026-10-02T12:00:00+09:00');

function dateDaysAgo(days: number): string {
  const d = new Date('2026-10-02T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** paceSec/km で指定して1本つくる。 */
function run(daysAgo: number, km: number, paceSec: number): ActivityLog {
  const date = dateDaysAgo(daysAgo);
  return {
    id: `a${daysAgo}-${paceSec}`,
    date,
    type: 'run',
    distanceKm: km,
    durationMin: Math.round((paceSec * km) / 60),
    createdAt: `${date}T10:00:00.000Z`,
  };
}

const profileOf = (activities: ActivityLog[], extra: Partial<RunnerProfile> = {}): RunnerProfile => ({
  ...createDefaultProfile('u1', '2025-01-01T00:00:00.000Z'),
  activities,
  ...extra,
});

/** n本を、指定したペースの並びで作る。 */
function series(paces: number[], km = 10): ActivityLog[] {
  return paces.map((pace, index) => run(index * 2 + 1, km, pace));
}

describe('材料が足りなければ、形を語らない', () => {
  it('本数が足りなければ null', () => {
    const few = series(Array.from({ length: MIN_RUNS - 1 }, () => 320));
    expect(paceMix(profileOf(few), NOW)).toBeNull();
  });

  it(`${MIN_RUNS}本そろえば出す`, () => {
    const enough = series(Array.from({ length: MIN_RUNS }, () => 320));
    expect(paceMix(profileOf(enough), NOW)).not.toBeNull();
  });

  it('記録が無ければ null', () => {
    expect(paceMix(profileOf([]), NOW)).toBeNull();
  });

  it('カルテが無ければ null', () => {
    expect(paceMix(null, NOW)).toBeNull();
  });

  it(`${WINDOW_DAYS}日より古い記録は数えない`, () => {
    const old = Array.from({ length: 20 }, (_, index) => run(WINDOW_DAYS + index + 1, 10, 320));
    expect(paceMix(profileOf(old), NOW)).toBeNull();
  });

  it('短すぎる記録は数えない（流しや帰り道を混ぜない）', () => {
    const shorts = Array.from({ length: 20 }, (_, index) => run(index + 1, 1.5, 320));
    expect(paceMix(profileOf(shorts), NOW)).toBeNull();
  });
});

describe('基準は、走れている力から作る', () => {
  /**
   * 3時間半を目指しているが、実際は4時間半の力。
   * **目標から帯を作ると「全部イージー」と出てしまい、逆の助言になる。**
   */
  it('届いていない目標ではなく、実際に走れたペースを基準にする', () => {
    // 6:00/km 前後でしか走っていない人が、サブ3.5（4:58/km）を目標にしている。
    const runs = series(Array.from({ length: 20 }, () => 360));
    const mix = paceMix(
      profileOf(runs, { goal: { kind: 'time', summary: 'サブ3.5', targetTime: '3:30:00' } }),
      NOW,
    );

    expect(mix?.anchorFrom).toBe('performance');
    // 目標ペース(298秒)ではなく、走れている力に近いところに基準が来る。
    expect(mix!.anchorPaceSec).toBeGreaterThan(330);
    // 全部が「ゆっくり」にはならない。
    expect(mix!.bands.find((band) => band.band === 'easy')!.percent).toBeLessThan(100);
  });

  it('基準にした記録を、そのまま見せる', () => {
    const runs = series(Array.from({ length: 20 }, () => 330));
    const mix = paceMix(profileOf(runs), NOW);
    expect(mix?.anchorRun?.pace).toBeDefined();
    expect(mix?.anchorRun?.km).toBeGreaterThan(0);
  });
});

describe('形を読む', () => {
  /**
   * 速い日はあるのに、ゆっくりの日が無い。
   * **「刺激が足りない」とは別の話で、助言も逆になる。**
   */
  it('速い日はあるが、ゆっくりの日が無い人に、抜く日を勧める', () => {
    // 実力マラソン相当 5:20/km の人が、全部 5:00〜5:30 で走っている。
    const paces = [300, 320, 325, 318, 300, 322, 328, 315, 300, 325, 320, 318, 302, 324, 326, 316];
    const mix = paceMix(profileOf(series(paces)), NOW);

    expect(mix?.verdict).toBe('no-easy');
    expect(mix?.headline).toContain('ゆっくり');
    expect(mix?.next).toContain('より遅く');
    // 速い日があることは認める。足りないのは強度ではない。
    expect(mix!.bands.find((band) => band.band === 'hard')!.percent).toBeGreaterThan(0);
  });

  it('中くらいの速さだけで、速い日も無い人に、強弱を勧める', () => {
    // いちばん速い1本を基準にして、残りが全部そのすぐ内側に収まる形。
    const paces = [300, 330, 335, 332, 338, 334, 336, 331, 337, 333, 335, 339, 334, 336, 332];
    const mix = paceMix(profileOf(series(paces)), NOW);
    expect(['grey', 'no-easy']).toContain(mix?.verdict);
  });

  it('ゆっくりばかりの人には、速い日を勧める', () => {
    // 1本だけ速く、あとは全部とても遅い。
    const paces = [300, 430, 440, 435, 445, 438, 442, 436, 444, 439, 441, 437, 443, 434, 446];
    const mix = paceMix(profileOf(series(paces)), NOW);
    expect(mix?.verdict).toBe('flat');
    expect(mix?.next).toContain('速い');
  });

  /** **狼少年にしない。** 分かれている人に余計なことを言うと、誰も読まなくなる。 */
  it('分かれている人には、変えろと言わない', () => {
    // 8割をしっかり遅く、2割を速く。
    const easy = Array.from({ length: 12 }, () => 430);
    const hard = Array.from({ length: 4 }, () => 300);
    const mix = paceMix(profileOf(series([...hard, ...easy])), NOW);

    expect(mix?.verdict).toBe('balanced');
    expect(mix?.next).toBeUndefined();
  });
});

describe('数え方', () => {
  /** 30kmのロング1本と5kmのジョグ1本を、同じ1票にしない。 */
  it('本数ではなく距離で数える', () => {
    const runs = [
      ...Array.from({ length: 10 }, (_, index) => run(index * 2 + 1, 3, 430)),
      ...Array.from({ length: 6 }, (_, index) => run(index * 2 + 2, 30, 330)),
    ];
    const mix = paceMix(profileOf(runs), NOW);
    const easy = mix!.bands.find((band) => band.band === 'easy')!;
    // 本数では 10 対 6 で「ゆっくり」が多いが、距離では 30km 対 180km。
    expect(easy.runs).toBe(10);
    expect(easy.percent).toBeLessThan(50);
  });

  it('割合は合計100%になる', () => {
    const mix = paceMix(profileOf(series([300, 330, 340, 350, 430, 440, 320, 325, 420, 310, 335, 345, 355, 425])), NOW);
    const total = mix!.bands.reduce((sum, band) => sum + band.percent, 0);
    expect(Math.abs(total - 100)).toBeLessThanOrEqual(1);
  });

  it('あり得ないペースの記録は数えない', () => {
    const runs = [...series(Array.from({ length: 15 }, () => 330)), run(1, 10, 20)];
    const mix = paceMix(profileOf(runs), NOW);
    expect(mix!.runs).toBe(15);
  });
});

describe('コーチに渡す指示', () => {
  it('集計と、言ってはいけないことを渡す', () => {
    const paces = [300, 320, 325, 318, 300, 322, 328, 315, 300, 325, 320, 318, 302, 324, 326, 316];
    const doctrine = mixDoctrine(profileOf(series(paces)), NOW);

    expect(doctrine).toContain('自分で数え直さないこと');
    expect(doctrine).toContain('junk miles');
    expect(doctrine).toContain('痛みがある時は、速い日を勧めないこと');
  });

  it('材料が足りなければ、何も渡さない', () => {
    expect(mixDoctrine(profileOf([]), NOW)).toBeNull();
  });

  it('目標から帯を作った時は、断定を弱めるよう伝える', () => {
    // 距離が短すぎて力を測れないが、目標はある人。
    const runs = Array.from({ length: 15 }, (_, index) => run(index + 1, 3, 400));
    const doctrine = mixDoctrine(
      profileOf(runs, { goal: { kind: 'time', summary: 'サブ4', targetTime: '4:00:00' } }),
      NOW,
    );
    if (doctrine && doctrine.includes('目標から帯を作っている')) {
      expect(doctrine).toContain('断定を弱める');
    }
  });
});

describe('画面に出す文字', () => {
  it('** が残っていない', () => {
    const paces = [300, 320, 325, 318, 300, 322, 328, 315, 300, 325, 320, 318, 302, 324, 326, 316];
    const mix = paceMix(profileOf(series(paces)), NOW)!;
    expect(mix.headline).not.toContain('**');
    expect(mix.detail).not.toContain('**');
    expect(mix.next ?? '').not.toContain('**');
    for (const band of mix.bands) expect(band.label).not.toContain('**');
  });

  /** 本人はまじめに走っている。責める言葉を画面に出さない。 */
  it('責める言葉を使っていない', () => {
    const paces = [300, 320, 325, 318, 300, 322, 328, 315, 300, 325, 320, 318, 302, 324, 326, 316];
    const mix = paceMix(profileOf(series(paces)), NOW)!;
    const text = `${mix.headline}${mix.detail}${mix.next ?? ''}`;
    for (const word of ['無駄', 'junk', 'ダメ', '間違っ']) expect(text).not.toContain(word);
  });
});
