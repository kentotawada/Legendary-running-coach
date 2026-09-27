import { describe, expect, it } from 'vitest';
import {
  EXERCISES,
  LM,
  angleAt,
  findExercise,
  offsetFromLine,
  visibleSide,
  type Landmarks,
  type Point,
} from '@/lib/exercise';

/**
 * 姿勢の判定。
 *
 * **カメラ無しで確かめられるように作ってある。** 座標を手で組み立てて渡し、
 * 返ってくる一言を見る。ここが検証できないと、
 * 「たぶん合っている」フォーム指導を人に出すことになる。
 */

/** 全部見えている前提の骨組みを作る。指定した点だけ差し替える。 */
function body(points: Record<number, [number, number]>): Landmarks {
  const landmarks: Point[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  for (const [index, [x, y]] of Object.entries(points)) {
    landmarks[Number(index)] = { x, y, visibility: 0.9 };
  }
  return landmarks;
}

describe('角度', () => {
  it('まっすぐなら180度', () => {
    expect(angleAt({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 })).toBeCloseTo(180, 5);
  });

  it('直角は90度', () => {
    expect(angleAt({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(90, 5);
  });

  it('点が重なっても落ちない', () => {
    expect(angleAt({ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 2 })).toBe(0);
  });
});

describe('線からのずれ', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 1, y: 0 };

  it('線の上なら0', () => {
    expect(offsetFromLine({ x: 0.5, y: 0 }, a, b)).toBeCloseTo(0, 6);
  });

  /** **符号が命。** これが逆だと「落ちている」と「上がっている」が入れ替わる。 */
  it('画面の下へずれていたら正', () => {
    expect(offsetFromLine({ x: 0.5, y: 0.2 }, a, b)).toBeGreaterThan(0);
  });

  it('画面の上へずれていたら負', () => {
    expect(offsetFromLine({ x: 0.5, y: -0.2 }, a, b)).toBeLessThan(0);
  });

  it('写り方の大小で変わらない', () => {
    const small = offsetFromLine({ x: 0.5, y: 0.1 }, { x: 0, y: 0 }, { x: 1, y: 0 });
    const large = offsetFromLine({ x: 5, y: 1 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(small).toBeCloseTo(large, 6);
  });
});

describe('よく見えている側', () => {
  it('確からしさが高いほうを選ぶ', () => {
    const landmarks: Point[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0.1 }));
    landmarks[LM.rightShoulder] = { x: 0, y: 0, visibility: 0.9 };
    landmarks[LM.rightHip] = { x: 0, y: 0, visibility: 0.9 };
    expect(visibleSide(landmarks)).toBe('right');
  });
});

describe('プランク', () => {
  const plank = findExercise('strength-plank')!;

  /** 肩・腰・足首が一直線、肘は肩の真下。 */
  const straight = () =>
    body({
      [LM.leftShoulder]: [0.3, 0.5],
      [LM.leftHip]: [0.55, 0.5],
      [LM.leftAnkle]: [0.8, 0.5],
      [LM.leftElbow]: [0.3, 0.6],
    });

  it('一直線なら、直すところは無い', () => {
    const result = plank.evaluate(straight());
    expect(result.holding).toBe(true);
    expect(result.fix).toBe(false);
  });

  it('腰が落ちていたら、そう言う', () => {
    const sagging = body({
      [LM.leftShoulder]: [0.3, 0.5],
      // 画面の下＝体が沈んでいる
      [LM.leftHip]: [0.55, 0.58],
      [LM.leftAnkle]: [0.8, 0.5],
      [LM.leftElbow]: [0.3, 0.6],
    });
    const result = plank.evaluate(sagging);
    expect(result.fix).toBe(true);
    expect(result.cue).toContain('落ちて');
  });

  it('腰が上がっていたら、落ちているとは言わない', () => {
    const piked = body({
      [LM.leftShoulder]: [0.3, 0.5],
      [LM.leftHip]: [0.55, 0.42],
      [LM.leftAnkle]: [0.8, 0.5],
      [LM.leftElbow]: [0.3, 0.6],
    });
    const result = piked.length ? plank.evaluate(piked) : null;
    expect(result!.fix).toBe(true);
    expect(result!.cue).toContain('上がって');
    expect(result!.cue).not.toContain('落ちて');
  });

  it('肘が肩の真下から外れていたら、そこを言う', () => {
    const forward = body({
      [LM.leftShoulder]: [0.3, 0.5],
      [LM.leftHip]: [0.55, 0.5],
      [LM.leftAnkle]: [0.8, 0.5],
      // 肘が前に出すぎている
      [LM.leftElbow]: [0.42, 0.6],
    });
    expect(forward.length).toBe(33);
    const result = plank.evaluate(forward);
    expect(result.fix).toBe(true);
    expect(result.cue).toContain('肘');
  });

  /** **直すところは一度に1つ。** 3つ同時に直せる人はいない。 */
  it('直すところが2つあっても、言うのは1つ', () => {
    const bad = body({
      [LM.leftShoulder]: [0.3, 0.5],
      [LM.leftHip]: [0.55, 0.6],
      [LM.leftAnkle]: [0.8, 0.5],
      [LM.leftElbow]: [0.45, 0.6],
    });
    const result = plank.evaluate(bad);
    expect(result.cue.split('。').filter(Boolean).length).toBeLessThanOrEqual(2);
  });

  it('全身がうつっていなければ、判定せずに下がってもらう', () => {
    const cropped: Point[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
    const result = plank.evaluate(cropped);
    expect(result.fix).toBe(false);
    expect(result.cue).toContain('うつる');
  });

  /** 呼吸のゆれで注意され続けないこと。 */
  it('わずかな揺れでは、注意しない', () => {
    const breathing = body({
      [LM.leftShoulder]: [0.3, 0.5],
      [LM.leftHip]: [0.55, 0.512],
      [LM.leftAnkle]: [0.8, 0.5],
      [LM.leftElbow]: [0.3, 0.6],
    });
    expect(breathing.length).toBe(33);
    expect(plank.evaluate(breathing).fix).toBe(false);
  });
});

describe('カーフレイズ', () => {
  const calf = findExercise('strength-calf-raise')!;

  it('膝が曲がっていたら、そこを先に言う', () => {
    const bent = body({
      [LM.leftHip]: [0.5, 0.3],
      [LM.leftKnee]: [0.56, 0.55],
      [LM.leftAnkle]: [0.5, 0.8],
      [LM.leftHeel]: [0.48, 0.82],
      [LM.leftToe]: [0.56, 0.82],
    });
    const result = calf.evaluate(bent);
    expect(result.fix).toBe(true);
    expect(result.cue).toContain('膝');
  });

  it('かかとが上がっていれば、上がっていると数える', () => {
    const up = body({
      [LM.leftHip]: [0.5, 0.3],
      [LM.leftKnee]: [0.5, 0.55],
      [LM.leftAnkle]: [0.5, 0.8],
      // かかとが、つま先より高い（y が小さい）
      [LM.leftHeel]: [0.48, 0.74],
      [LM.leftToe]: [0.56, 0.82],
    });
    expect(calf.evaluate(up).holding).toBe(true);
  });

  it('かかとが床にあれば、まだ上がっていない', () => {
    const down = body({
      [LM.leftHip]: [0.5, 0.3],
      [LM.leftKnee]: [0.5, 0.55],
      [LM.leftAnkle]: [0.5, 0.8],
      [LM.leftHeel]: [0.48, 0.82],
      [LM.leftToe]: [0.56, 0.82],
    });
    expect(calf.evaluate(down).holding).toBe(false);
  });
});

describe('片脚スクワット', () => {
  const squat = findExercise('strength-single-leg-squat')!;

  it('膝が内に入っていたら、そこを言う', () => {
    const inward = body({
      [LM.leftHip]: [0.5, 0.3],
      // 左脚なので、画面の左（x が小さい）側へ出るのが「内」
      [LM.leftKnee]: [0.42, 0.55],
      [LM.leftAnkle]: [0.5, 0.8],
    });
    const result = squat.evaluate(inward);
    expect(result.fix).toBe(true);
    expect(result.cue).toContain('内');
  });

  it('まっすぐ沈めていれば、深さの話になる', () => {
    const good = body({
      [LM.leftHip]: [0.5, 0.35],
      [LM.leftKnee]: [0.52, 0.55],
      [LM.leftAnkle]: [0.5, 0.8],
    });
    const result = squat.evaluate(good);
    expect(result.fix).toBe(false);
    expect(result.readout?.label).toBe('膝の角度');
  });
});

describe('種目の定義', () => {
  it('どの種目にも、撮り方の案内がある', () => {
    // **これが無いと、何を測っても意味のない角度になる。**
    for (const exercise of EXERCISES) {
      expect(exercise.setup.length, exercise.name).toBeGreaterThan(10);
      expect(['side', 'front']).toContain(exercise.view);
    }
  });

  it('説明図の id と揃っている', async () => {
    // コーチが同じ図を出せるように、id を共有している。
    const { FIGURES } = await import('@/lib/figures');
    const ids = new Set(FIGURES.map((figure) => figure.id));
    for (const exercise of EXERCISES) {
      expect(ids.has(exercise.id), exercise.id).toBe(true);
    }
  });
});
