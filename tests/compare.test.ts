import { describe, expect, it } from 'vitest';
import { compareWithPast, comparisonDoctrine, describeComparison, paceText } from '@/lib/compare';
import { createDefaultProfile } from '@/lib/types';
import type { ActivityLog, RunnerProfile } from '@/lib/types';

/**
 * 過去の自分との比較。
 *
 * **ここは、良くなった時だけ出すと価値がゼロになる場所。**
 * 落ちている時も同じ形で出ることを、テストで固定しておく。
 *
 * 比べる条件（距離の幅・何日離れているか・何本あるか）も固定する。
 * 条件が緩むと、別の種類の練習や、その日の調子を比べて断定してしまう。
 */

const NOW = new Date('2026-10-01T12:00:00+09:00');
const TODAY = '2026-10-01';

function dateDaysAgo(days: number): string {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** 走った記録を1本。daysAgo=0 が今日。 */
function run(
  daysAgo: number,
  km: number,
  min: number,
  hr?: number,
  type: ActivityLog['type'] = 'run',
): ActivityLog {
  const date = dateDaysAgo(daysAgo);
  return {
    id: `a-${daysAgo}-${km}`,
    date,
    type,
    distanceKm: km,
    durationMin: min,
    metrics: hr !== undefined ? { avgHr: hr } : undefined,
    createdAt: `${date}T12:00:00.000Z`,
  };
}

/** 古い順に並べる。実際の保存も走った順。 */
function profileOf(activities: ActivityLog[]): RunnerProfile {
  return {
    ...createDefaultProfile('t'),
    activities: [...activities].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/** 今日 20km を 110分（5:30/km）・心拍148。 */
const TODAY_RUN = run(0, 20, 110, 148);
/** 2〜3か月前の 20km を 114分（5:42/km）・心拍152。 */
const PAST_RUNS = [run(60, 20, 114, 152), run(75, 20, 114, 152), run(90, 20, 114, 152)];

describe('似た練習を選ぶ条件', () => {
  it('同じくらいの距離を、1〜4か月前から3本集めて平均と比べる', () => {
    const result = compareWithPast(profileOf([...PAST_RUNS, TODAY_RUN]), TODAY_RUN)!;

    expect(result.samples).toBe(3);
    expect(result.nowKm).toBe(20);
    expect(result.nowPaceSec).toBe(330);
    expect(result.pastPaceSec).toBe(342);
    expect(result.fromDaysAgo).toBe(90);
    expect(result.toDaysAgo).toBe(60);
  });

  it('距離が15%以上離れていたら、別の練習として比べない', () => {
    // 20km に対して 23.5km（+17.5%）。
    const far = [run(60, 23.5, 134, 152), run(75, 23.5, 134, 152)];
    expect(compareWithPast(profileOf([...far, TODAY_RUN]), TODAY_RUN)).toBeNull();

    // 22km（+10%）なら同じ練習として見る。
    const near = [run(60, 22, 125, 152), run(75, 22, 125, 152)];
    expect(compareWithPast(profileOf([...near, TODAY_RUN]), TODAY_RUN)).not.toBeNull();
  });

  it('直前の数日とは比べない。調子の上下しか見えないため', () => {
    const recent = [run(5, 20, 114, 152), run(10, 20, 114, 152)];
    expect(compareWithPast(profileOf([...recent, TODAY_RUN]), TODAY_RUN)).toBeNull();
  });

  it('古すぎる記録とも比べない。別人の記録を比べているのと同じになる', () => {
    const ancient = [run(150, 20, 114, 152), run(200, 20, 114, 152)];
    expect(compareWithPast(profileOf([...ancient, TODAY_RUN]), TODAY_RUN)).toBeNull();
  });

  it('1本しか無ければ出さない。その日の調子で決まってしまう', () => {
    const single = [run(60, 20, 114, 152)];
    expect(compareWithPast(profileOf([...single, TODAY_RUN]), TODAY_RUN)).toBeNull();
  });

  it('短い練習は比べない。流しやつなぎが混ざる', () => {
    const short = run(0, 4, 22, 148);
    const pastShort = [run(60, 4, 23, 152), run(75, 4, 23, 152)];
    expect(compareWithPast(profileOf([...pastShort, short]), short)).toBeNull();
  });

  it('種目が違うものは混ぜない', () => {
    const walks = [run(60, 20, 114, 152, 'walk'), run(75, 20, 114, 152, 'walk')];
    expect(compareWithPast(profileOf([...walks, TODAY_RUN]), TODAY_RUN)).toBeNull();
  });

  it('自分自身は相手に数えない', () => {
    const twin = { ...TODAY_RUN };
    expect(compareWithPast(profileOf([twin]), twin)).toBeNull();
  });
});

describe('良くなったかどうかの見分け', () => {
  it('心拍が下がってペースが上がれば、同じ心拍で進める量が増えたと出す', () => {
    const result = compareWithPast(profileOf([...PAST_RUNS, TODAY_RUN]), TODAY_RUN)!;

    expect(result.paceDeltaSec).toBe(-12);
    expect(result.hrDelta).toBe(-4);
    expect(result.efficiencyPercent).toBe(6.4);
    expect(result.verdict).toBe('better');
  });

  /**
   * **ペースだけでは分からない。** 心拍を上げて速く走っただけなら、
   * 強くなったとは言えない。効率が±2%の中なら「同じくらい」。
   */
  it('ペースが上がっても心拍も上がっていれば、同じくらいと出す', () => {
    const today = run(0, 20, 108, 158); // 5:24/km・心拍158
    const result = compareWithPast(profileOf([...PAST_RUNS, today]), today)!;

    expect(result.paceDeltaSec).toBe(-18);
    expect(result.hrDelta).toBe(6);
    expect(Math.abs(result.efficiencyPercent!)).toBeLessThan(2);
    expect(result.verdict).toBe('same');
  });

  it('落ちている時も、同じ条件で判定する', () => {
    const today = run(0, 20, 118, 158); // 5:54/km・心拍158
    const result = compareWithPast(profileOf([...PAST_RUNS, today]), today)!;

    expect(result.paceDeltaSec).toBe(12);
    expect(result.hrDelta).toBe(6);
    expect(result.efficiencyPercent).toBe(-7.1);
    expect(result.verdict).toBe('harder');
  });

  it('心拍が無い時は、ペースだけで見る', () => {
    const today = run(0, 20, 110);
    const past = [run(60, 20, 114), run(75, 20, 114)];
    const result = compareWithPast(profileOf([...past, today]), today)!;

    expect(result.pastHr).toBeUndefined();
    expect(result.efficiencyPercent).toBeUndefined();
    expect(result.paceDeltaSec).toBe(-12);
    expect(result.verdict).toBe('better');
  });

  it('過去の半分に心拍が無ければ、心拍の平均は使わない', () => {
    const past = [run(60, 20, 114, 152), run(75, 20, 114), run(90, 20, 114)];
    const result = compareWithPast(profileOf([...past, TODAY_RUN]), TODAY_RUN)!;

    expect(result.pastHr).toBeUndefined();
    expect(result.efficiencyPercent).toBeUndefined();
  });

  it('ありえない心拍は読み取りの誤りとして捨てる', () => {
    const today = run(0, 20, 110, 15);
    const result = compareWithPast(profileOf([...PAST_RUNS, today]), today)!;

    expect(result.nowHr).toBeUndefined();
    expect(result.efficiencyPercent).toBeUndefined();
  });
});

describe('画面に出す言葉', () => {
  it('良くなった時と落ちた時で、同じ形の文を出す', () => {
    const better = describeComparison(
      compareWithPast(profileOf([...PAST_RUNS, TODAY_RUN]), TODAY_RUN)!,
    );
    const worse = run(0, 20, 118, 158);
    const harder = describeComparison(
      compareWithPast(profileOf([...PAST_RUNS, worse]), worse)!,
    );

    for (const text of [better.detail, harder.detail]) {
      expect(text).toContain('同じくらいの距離（20km前後）');
      expect(text).toContain('で走っていました（3本の平均）');
      expect(text).toContain('この練習は');
    }
    expect(better.detail).toContain('5:42/km・心拍152');
    expect(better.detail).toContain('5:30/km・心拍148');
    expect(harder.detail).toContain('5:54/km・心拍158');

    expect(better.title).toBe('同じ心拍で、前より速く走れています');
    expect(harder.title).toBe('前より、同じ距離がきつくなっています');
    // 落ちている時は、責めずに原因の候補を置く。
    expect(harder.detail).toContain('暑さや風の影響');
  });

  it('期間が離れている時は幅で、近い時は一点で言う', () => {
    const wide = describeComparison(
      compareWithPast(profileOf([...PAST_RUNS, TODAY_RUN]), TODAY_RUN)!,
    );
    expect(wide.detail).toContain('3か月前〜2か月前');

    const close = [run(28, 20, 114, 152), run(30, 20, 114, 152)];
    const narrow = describeComparison(
      compareWithPast(profileOf([...close, TODAY_RUN]), TODAY_RUN)!,
    );
    expect(narrow.detail).toContain('4週間前は');
    expect(narrow.detail).not.toContain('〜');
  });

  it('心拍が無い時は、速くなった秒数を見出しにする', () => {
    const today = run(0, 20, 110);
    const past = [run(60, 20, 114), run(75, 20, 114)];
    const text = describeComparison(compareWithPast(profileOf([...past, today]), today)!);

    expect(text.title).toBe('前より 12秒/km 速くなっています');
    expect(text.detail).not.toContain('心拍');
  });

  /** 画面では地の文として出す。`**` が書いてあると、そのまま文字で見える。 */
  it('画面に出す文に、記号を混ぜない', () => {
    const text = describeComparison(
      compareWithPast(profileOf([...PAST_RUNS, TODAY_RUN]), TODAY_RUN)!,
    );
    expect(`${text.title}${text.detail}`).not.toContain('**');
  });

  it('秒をペースの形に直す', () => {
    expect(paceText(330)).toBe('5:30');
    expect(paceText(342.4)).toBe('5:42');
    expect(paceText(245)).toBe('4:05');
  });
});

describe('プロンプトに差し込む比較', () => {
  it('計算済みの数値と、必ず触れる指示を載せる', () => {
    const text = comparisonDoctrine(profileOf([...PAST_RUNS, TODAY_RUN]), NOW)!;

    expect(text).toContain('の練習と、過去の自分との比較');
    expect(text).toContain('自分で数え直さないこと');
    expect(text).toContain('5:42/km・心拍152');
    expect(text).toContain('ペースは 12秒/km 速くなっている');
    expect(text).toContain('平均心拍は 4 低い');
    expect(text).toContain('+6.4%');
    expect(text).toContain('必ず一言触れること');
    // 落ちている時も出す、という指示そのものを固定する。
    expect(text).toContain('落ちている時も、同じように出すこと');
  });

  it('落ちている時も、同じ見出しで同じ量を載せる', () => {
    const worse = run(0, 20, 118, 158);
    const text = comparisonDoctrine(profileOf([...PAST_RUNS, worse]), NOW)!;

    expect(text).toContain('の練習と、過去の自分との比較');
    expect(text).toContain('ペースは 12秒/km 遅くなっている');
    expect(text).toContain('平均心拍は 6 高い');
    expect(text).toContain('-7.1%');
    expect(text).toContain('責めないこと');
  });

  /**
   * **2週間以上前の練習の比較を、毎ターン持ち出さない。**
   * 「見ている」ではなく「古い話をしている」になり、言われた側は白ける。
   */
  it('最後に走ったのが2週間以上前なら、載せない', () => {
    const stale = run(20, 20, 110, 148);
    expect(comparisonDoctrine(profileOf([...PAST_RUNS, stale]), NOW)).toBeNull();
  });

  it('どの日の練習についての比較かを書く', () => {
    const text = comparisonDoctrine(profileOf([...PAST_RUNS, TODAY_RUN]), NOW)!;
    expect(text).toContain(`# ${TODAY}の練習と、過去の自分との比較`);
  });

  it('比べる相手が無ければ、何も載せない', () => {
    expect(comparisonDoctrine(profileOf([TODAY_RUN]), NOW)).toBeNull();
    expect(comparisonDoctrine(profileOf([]), NOW)).toBeNull();
  });

  /** 区間が無くても比べられる。スクリーンショット1枚でも距離と時間は読める。 */
  it('区間の記録が無い練習でも比べる', () => {
    const text = comparisonDoctrine(profileOf([...PAST_RUNS, TODAY_RUN]), NOW)!;
    expect(text).toContain('同じくらいの距離');
  });

  it('いちばん新しい練習を相手に選ぶ', () => {
    const older = run(40, 20, 118, 158);
    const text = comparisonDoctrine(profileOf([...PAST_RUNS, older, TODAY_RUN]), NOW)!;
    // 今日の 5:30 が「いま」の側に来ていること。
    expect(text).toContain('この練習は 5:30/km・心拍148。');
  });
});
