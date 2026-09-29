import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBuildInfo } from '@/lib/build-info';
import { DEFAULT_MODEL, VISION_MODEL, modelName, visionModelName } from '@/lib/models';

/**
 * 画面が名乗るモデルと、実際に呼ぶモデル。
 *
 * **ここがずれると、いちばん困る形で嘘をつく。**
 * モデルを切り替えたのに /api/health とカルテは古い名前を出し続ける、という状態になり、
 * 「切り替えたつもりが効いていない」のか「表示が古いだけ」なのかを誰も切り分けられなくなる。
 * 実際に一度ずれた（費用を下げる時、gemini.ts だけ直して build-info.ts に
 * 上位モデル名が直書きのまま残っていた）。
 */
describe('名乗るモデルと、呼ぶモデル', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('既定では、報告と実物が一致する', () => {
    const build = getBuildInfo();
    expect(build.model).toBe(modelName());
    expect(build.visionModel).toBe(visionModelName());
  });

  it('環境変数で差し替えても、報告がついてくる', () => {
    vi.stubEnv('GEMINI_MODEL', 'gemini-3-flash-lite-preview');
    vi.stubEnv('GEMINI_MODEL_VISION', 'gemini-4-pro');

    const build = getBuildInfo();
    expect(build.model).toBe('gemini-3-flash-lite-preview');
    expect(build.visionModel).toBe('gemini-4-pro');
  });

  /** 貼り付け事故（引用符・前後の空白）で、実物と報告が別々に転ばないこと。 */
  it('引用符や空白が混ざっていても、両方そろって落とす', () => {
    vi.stubEnv('GEMINI_MODEL', ' "gemini-3-flash-preview" ');
    expect(getBuildInfo().model).toBe('gemini-3-flash-preview');
    expect(modelName()).toBe('gemini-3-flash-preview');
  });

  /**
   * **ふだんの会話が、上位モデルのままにならないこと。**
   * 実測で、上位モデルは1通あたり約17円。軽いモデルの6.5倍かかる。
   */
  it('ふだんの会話の既定は、軽いモデル', () => {
    expect(DEFAULT_MODEL).toContain('flash');
  });

  /** 画像の読み取りだけは、安いほうに倒さない。読み違えると助言そのものが狂う。 */
  it('画像の既定は、読み取りの強いモデル', () => {
    expect(VISION_MODEL).not.toBe(DEFAULT_MODEL);
  });
});
