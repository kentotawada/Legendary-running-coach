import { describe, expect, it } from 'vitest';
import { bodyBox, inBox, steadyBoxes, type Point2 } from '@/lib/pose';

/**
 * 見せる1コマの切り出し。
 *
 * **ここが効かないと、絵は「小さくて読めない人形」のまま。**
 * 全身を入れて撮ると人は画面の一部にしかならないので、
 * そこだけを囲んで大きく出す。囲み方を間違えると、体が切れる。
 */

/** 画面の一部にだけ人がいる状態を作る。 */
function person({
  x = 0.2,
  y = 0.3,
  w = 0.06,
  h = 0.25,
  visibility = 0.9,
}: Partial<{ x: number; y: number; w: number; h: number; visibility: number }> = {}): Point2[] {
  const points: Point2[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.02 }));
  // 頭から足まで、縦に並べる。左右にも少し散らす。
  for (let i = 0; i < 20; i += 1) {
    points[i + 11] = {
      x: x + (i % 2 === 0 ? 0 : w),
      y: y + (h * i) / 19,
      visibility,
    };
  }
  return points;
}

const ASPECT = 720 / 800;

describe('体のまわりを切り出す', () => {
  it('点が数個しか見えていなければ、切らない', () => {
    const hidden = person({ visibility: 0.05 });
    expect(bodyBox(hidden, ASPECT)).toBeNull();
  });

  /** **これが本題。** 引きで撮った動画をそのまま出すと、人が小さすぎて読めない。 */
  it('人が小さく写っていたら、そのぶん狭く切る', () => {
    const box = bodyBox(person(), ASPECT)!;
    expect(box.w).toBeLessThan(0.5);
    expect(box.h).toBeLessThan(0.6);
  });

  it('切り出した枠は、画面の中に収まっている', () => {
    for (const at of [0.02, 0.2, 0.5, 0.95]) {
      const box = bodyBox(person({ x: at, y: at }), ASPECT)!;
      expect(box.x, `x=${at}`).toBeGreaterThanOrEqual(0);
      expect(box.y, `y=${at}`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual(1.000001);
      expect(box.y + box.h).toBeLessThanOrEqual(1.000001);
    }
  });

  /** **体が切れたら意味がない。** 見えている点は全部、枠の中に入っていること。 */
  it('見えている点は、全部枠の中に入る', () => {
    const points = person();
    const box = bodyBox(points, ASPECT)!;
    for (const p of inBox(points, box).filter((_, i) => i >= 11 && i < 31)) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(1);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(1);
    }
  });

  it('ふちに余白がある。体がふちに接していると窮屈に見える', () => {
    const points = person();
    const shown = inBox(points, bodyBox(points, ASPECT)!);
    const ys = shown.filter((_, i) => i >= 11 && i < 31).map((p) => p.y);
    expect(Math.min(...ys)).toBeGreaterThan(0.03);
    expect(Math.max(...ys)).toBeLessThan(0.97);
  });

  it('頼まれた形に近づける。縦長の体でも、横に余裕を作る', () => {
    const box = bodyBox(person({ w: 0.02, h: 0.4 }), ASPECT)!;
    expect(box.w / box.h).toBeCloseTo(ASPECT, 2);
  });

  it('画面いっぱいに写っていても、枠は画面を超えない', () => {
    const box = bodyBox(person({ x: 0.05, y: 0.02, w: 0.9, h: 0.96 }), ASPECT)!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.w).toBeLessThanOrEqual(1);
    expect(box.h).toBeLessThanOrEqual(1);
  });
});

describe('枠の中を0〜1に読み替える', () => {
  it('枠の左上が0、右下が1になる', () => {
    const box = { x: 0.2, y: 0.4, w: 0.4, h: 0.2 };
    const out = inBox(
      [
        { x: 0.2, y: 0.4 },
        { x: 0.6, y: 0.6 },
        { x: 0.4, y: 0.5 },
      ],
      box,
    );
    expect(out[0].x).toBeCloseTo(0, 6);
    expect(out[0].y).toBeCloseTo(0, 6);
    expect(out[1].x).toBeCloseTo(1, 6);
    expect(out[1].y).toBeCloseTo(1, 6);
    expect(out[2].x).toBeCloseTo(0.5, 6);
  });

  it('確からしさなど、他の値はそのまま残る', () => {
    const out = inBox([{ x: 0.5, y: 0.5, visibility: 0.77 }], { x: 0, y: 0, w: 1, h: 1 });
    expect(out[0].visibility).toBe(0.77);
  });
});

describe('コマ送りの枠', () => {
  /** 人が画面の中を進んでいく、4コマぶん。 */
  const moving = [0.2, 0.35, 0.5, 0.65].map((x) => person({ x }));

  /**
   * **ここが本題。** コマごとに枠の大きさを決め直すと、
   * 送るたびに人が伸び縮みして、動きそのものを見比べられない。
   */
  it('どのコマでも、枠の大きさは同じ', () => {
    const boxes = steadyBoxes(moving, ASPECT);
    const widths = new Set(boxes.map((box) => box!.w.toFixed(6)));
    const heights = new Set(boxes.map((box) => box!.h.toFixed(6)));
    expect(widths.size).toBe(1);
    expect(heights.size).toBe(1);
  });

  it('位置は、その人について動く', () => {
    const boxes = steadyBoxes(moving, ASPECT);
    const xs = boxes.map((box) => box!.x);
    for (let i = 1; i < xs.length; i += 1) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
  });

  it('どのコマでも、その人は枠の中に入っている', () => {
    const boxes = steadyBoxes(moving, ASPECT);
    moving.forEach((points, i) => {
      for (const p of inBox(points, boxes[i]!).filter((_, j) => j >= 11 && j < 31)) {
        expect(p.x, `コマ${i}`).toBeGreaterThan(0);
        expect(p.x, `コマ${i}`).toBeLessThan(1);
      }
    });
  });

  /** **1コマの点の飛びで、全部が小さくならないこと。** */
  it('1コマだけ大きく外れても、他のコマの大きさを巻き込まない', () => {
    const calm = steadyBoxes(moving, ASPECT)[0]!;
    const withSpike = steadyBoxes([...moving, person({ x: 0.05, w: 0.9, h: 0.9 })], ASPECT)[0]!;
    expect(withSpike.w).toBeCloseTo(calm.w, 6);
  });

  it('見えていないコマは、枠を返さない', () => {
    const boxes = steadyBoxes([person(), person({ visibility: 0.05 })], ASPECT);
    expect(boxes[0]).not.toBeNull();
    expect(boxes[1]).toBeNull();
  });
});
