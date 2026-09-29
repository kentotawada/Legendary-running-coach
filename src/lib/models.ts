/**
 * どのモデルに頼むか。
 *
 * **費用のほぼ全部が、ここで決まる。**
 * 1回の返事で、固定の指示文と道具の説明あわせて約2万字（約1.3万トークン）を送る。
 * 道具を使えばそれを何度も送り直すので、実測で1通あたり入力5万トークンを超えた。
 * 上位のモデルのままでは、30人が毎日使うだけで月3〜6万円になる。
 *
 * **名前をここに1つだけ置いてあるのは、報告と実物がずれないため。**
 * /api/health が返すモデル名も、実際に呼ぶモデルも、ここを読む。
 * 別々に書くと、切り替えた時に画面だけ古い名前を出し続ける。
 */

import { cleanEnv } from './env';

/** ふだんの会話に使うモデル。環境変数 GEMINI_MODEL で変えられる。 */
export const DEFAULT_MODEL = 'gemini-3-flash-preview';

/**
 * 画像を見てもらう時だけ使う、読み取りの強いモデル。環境変数 GEMINI_MODEL_VISION。
 *
 * **分けているのは人ではなく、頼みごとの重さ。**
 * 時計の画面やフォームの写真から数値を読み取るのは、取り違えると助言そのものが狂う。
 * ここだけは安いほうに倒さない。無料の人か会員かでは切り替えない。
 */
export const VISION_MODEL = 'gemini-3-pro-preview';

export function modelName(): string {
  return cleanEnv(process.env.GEMINI_MODEL) || DEFAULT_MODEL;
}

export function visionModelName(): string {
  return cleanEnv(process.env.GEMINI_MODEL_VISION) || VISION_MODEL;
}
