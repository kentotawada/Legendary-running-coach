/**
 * 環境変数の読み取りで共通して要るもの。
 *
 * **build-info と models の両方から使うので、ここに置いてある。**
 * どちらかの中に置くと、もう一方から読む時に循環参照になる。
 */

/** 環境変数に紛れ込んだ引用符や空白を落とす。貼り付け事故がここで死なないように。 */
export function cleanEnv(value: string | undefined): string {
  if (!value) return '';
  return value.trim().replace(/^["']|["']$/g, '').trim();
}
