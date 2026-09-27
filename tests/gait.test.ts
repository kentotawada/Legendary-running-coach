import { describe, expect, it } from 'vitest';
import { LM, type Point } from '@/lib/exercise';
import { analyzeGait, describeGait, facingOf, peaks, smooth, type Frame } from '@/lib/gait';

/**
 * 走りの数字化。
 *
 * **カメラも動画も使わずに確かめる。** 走っている人を座標で組み立てて渡し、
 * 出てくる数字を見る。ここが検証できないと、
 * 「たぶん合っている」フォーム評価を人に出すことになる。
 */

/**
 * 走っている人を作る。
 * 左右の足が交互に接地し、腰が上下する。横から見ている前提。
 * @param stepsPerSecond 1秒あたりの接地回数（片足ではなく合計）
 */
function runner({
  seconds = 3,
  fps = 30,
  stepsPerSecond = 2.8,
  /** 接地した足が、腰よりどれだけ前に出るか（脚の長さに対する比） */
  ahead = 0.1,
  /** 進行方向。1 = 画面の右へ */
  facing = 1 as 1 | -1,
  bounce = 0.06,
}: Partial<{
  seconds: number;
  fps: number;
  stepsPerSecond: number;
  ahead: number;
  facing: 1 | -1;
  bounce: number;
}> = {}): Frame[] {
  const frames: Frame[] = [];
  const count = Math.round(seconds * fps);
  const legLength = 0.4;

  for (let i = 0; i < count; i += 1) {
    const t = i / fps;
    // 左右で半周期ずれる。1歩 = 半周期。
    const phase = 2 * Math.PI * (stepsPerSecond / 2) * t;
    const hipY = 0.45 + (bounce * legLength * Math.sin(2 * phase)) / 2;

    const points: Point[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.05 }));
    const see = (index: number, x: number, y: number) => {
      points[index] = { x, y, visibility: 0.95 };
    };

    const hipX = 0.5;
    see(LM.leftHip, hipX, hipY);
    see(LM.rightHip, hipX, hipY);
    see(LM.leftShoulder, hipX, hipY - 0.2);
    see(LM.rightShoulder, hipX, hipY - 0.2);

    for (const [side, offset] of [
      ['left', 0],
      ['right', Math.PI],
    ] as const) {
      const swing = Math.sin(phase + offset);
      // 足首は、接地の瞬間にいちばん下（y が最大）へ来る。
      const ankleY = hipY + legLength - 0.05 * (1 - Math.cos(phase + offset)) / 2;
      const ankleX = hipX + facing * ahead * legLength * swing;
      const ai = side === 'left' ? LM.leftAnkle : LM.rightAnkle;
      const ki = side === 'left' ? LM.leftKnee : LM.rightKnee;
      const hi = side === 'left' ? LM.leftHeel : LM.rightHeel;
      const ti = side === 'left' ? LM.leftToe : LM.rightToe;

      see(ai, ankleX, ankleY);
      see(ki, (hipX + ankleX) / 2, (hipY + ankleY) / 2);
      see(hi, ankleX - facing * 0.02, ankleY + 0.01);
      see(ti, ankleX + facing * 0.04, ankleY + 0.01);
    }

    frames.push({ t, points });
  }

  return frames;
}

describe('ならし', () => {
  it('とがった1点をならす', () => {
    const out = smooth([0, 0, 3, 0, 0]);
    expect(out[2]).toBeLessThan(3);
    expect(out[2]).toBeGreaterThan(0);
  });

  it('長さは変わらない', () => {
    expect(smooth([1, 2, 3]).length).toBe(3);
  });
});

describe('山を数える', () => {
  it('離れた山は別々に数える', () => {
    expect(peaks([0, 5, 0, 0, 0, 5, 0], 2)).toEqual([1, 5]);
  });

  /** **同じ一歩を2回数えると、ピッチが倍になる。** */
  it('近すぎる山は1つにまとめる', () => {
    expect(peaks([0, 5, 0, 6, 0], 3)).toEqual([3]);
  });

  it('山が無ければ空', () => {
    expect(peaks([1, 1, 1, 1], 2)).toEqual([]);
  });
});

describe('進行方向', () => {
  it('右へ走っていれば +1', () => {
    expect(facingOf(runner({ facing: 1 }))).toBe(1);
  });

  /** **腰の横移動では決めない。** トレッドミルでは腰が動かない。 */
  it('左へ走っていれば -1（その場で走っていても、つま先の向きで分かる）', () => {
    expect(facingOf(runner({ facing: -1 }))).toBe(-1);
  });
});

describe('走りの数字', () => {
  it('ピッチが、撮ったときの歩数と合う', () => {
    const report = analyzeGait(runner({ stepsPerSecond: 2.8, seconds: 4 }));
    expect(report.measured).toBe(true);
    // 2.8歩/秒 = 168 spm
    expect(report.cadence).toBeGreaterThan(150);
    expect(report.cadence).toBeLessThan(190);
  });

  it('体の真下で着いていれば、接地位置はほぼ0', () => {
    const report = analyzeGait(runner({ ahead: 0 }));
    expect(Math.abs(report.ahead ?? 1)).toBeLessThan(0.08);
  });

  /** **符号が命。** 逆だと「前で着いている」と「後ろで着いている」が入れ替わる。 */
  it('前で着いていれば、接地位置は正になる', () => {
    const report = analyzeGait(runner({ ahead: 0.35 }));
    expect(report.ahead).toBeGreaterThan(0);
  });

  it('進行方向が逆でも、前は前として出る', () => {
    const right = analyzeGait(runner({ ahead: 0.35, facing: 1 }));
    const left = analyzeGait(runner({ ahead: 0.35, facing: -1 }));
    expect(Math.sign(right.ahead ?? 0)).toBe(Math.sign(left.ahead ?? 0));
  });

  it('上下動が大きければ、大きく出る', () => {
    const small = analyzeGait(runner({ bounce: 0.03 }));
    const large = analyzeGait(runner({ bounce: 0.12 }));
    expect(large.bounce).toBeGreaterThan(small.bounce ?? 0);
  });

  it('接地を何回ぶん測ったかを持っている', () => {
    const report = analyzeGait(runner({ seconds: 4 }));
    expect(report.contacts.length).toBeGreaterThanOrEqual(3);
    for (const contact of report.contacts) {
      expect(['left', 'right']).toContain(contact.side);
      expect(contact.knee).toBeGreaterThan(0);
    }
  });
});

describe('測れなかったとき', () => {
  /** **黙って0を返さない。** 0は「真下で着いた」という意味になってしまう。 */
  it('コマが足りなければ、そう言う', () => {
    const report = analyzeGait(runner({ seconds: 0.1 }));
    expect(report.measured).toBe(false);
    expect(report.ahead).toBeUndefined();
    expect(report.note).toContain('長く');
  });

  it('全身がうつっていなければ、そう言う', () => {
    const frames = runner().map((frame) => ({
      ...frame,
      points: frame.points.map((p) => ({ ...p, visibility: 0.1 })),
    }));
    const report = analyzeGait(frames);
    expect(report.measured).toBe(false);
    expect(report.note).toContain('うつって');
  });
});

describe('コーチへ渡す文章', () => {
  const report = analyzeGait(runner({ seconds: 4 }));

  it('測った数字が入っている', () => {
    const text = describeGait(report);
    expect(text).toContain('ピッチ');
    expect(text).toContain('接地位置');
    expect(text).toContain('体幹');
  });

  /** **一般的な「良い数値」を当てはめさせない。** ここが抜けると、
   *  その人にとって正しい動きを直させることになる。 */
  it('良し悪しを決めつけないよう、釘を刺している', () => {
    const text = describeGait(report);
    expect(text).toContain('良い数値」を当てはめない');
    expect(text).toContain('過去の測定と比べて');
    expect(text).toContain('初回なら');
  });

  it('測れなかった時は、理由をそのまま返す', () => {
    const failed = analyzeGait(runner({ seconds: 0.1 }));
    expect(describeGait(failed)).toBe(failed.note);
  });
});
