/**
 * 会話履歴に埋め込む内部マーカー。
 * 画面に出すべきでない発言や、保存時に本体を落とした添付の跡を示す。
 */

/** 内部指示であることの印。この印が付いた発言は画面に表示しない。 */
export const INTERNAL_PREFIX = '[[coach:internal]]';

/** 画像添付の跡。画像そのものは保存しないので、あったことだけを残す。 */
export const IMAGE_MARKER = '[[coach:image]]';

export function imagePlaceholder(count: number): string {
  return `${IMAGE_MARKER} （この発言には画像が${count}枚添付されていました。数値は読み取り済みで、カルテに記録してあります）`;
}

/** マーカー付きテキストから、添付枚数を取り出す。 */
export function attachmentCountOf(text: string): number {
  if (!text.startsWith(IMAGE_MARKER)) return 0;
  const match = text.match(/画像が(\d+)枚/);
  return match ? Number(match[1]) : 1;
}
