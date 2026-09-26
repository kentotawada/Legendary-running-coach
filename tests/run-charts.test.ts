import { describe, expect, it } from 'vitest';
import { scaleOf } from '@/components/RunCharts';

/**
 * グラフの縦軸。
 * **変わらなかった項目を、枠線に見せない。**
 */
describe('scaleOf', () => {
  it('ふつうの幅は、そのまま使う', () => {
    expect(scaleOf(150, 170)).toEqual({ base: 150, span: 20 });
  });

  it('ずっと同じ値なら、真ん中に置く', () => {
    const { base, span } = scaleOf(132, 132);
    // 値が中央（0.5）に来る＝線が上端にも下端にも貼りつかない。
    expect((132 - base) / span).toBe(0.5);
  });

  it('幅を0にしない', () => {
    expect(scaleOf(9.4, 9.4).span).toBeGreaterThan(0);
  });
});
