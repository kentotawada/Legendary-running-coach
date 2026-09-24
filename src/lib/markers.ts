/**
 * 会話履歴に埋め込む内部マーカー。
 * 画面に出すべきでない発言や、保存時に本体を落とした添付の跡を示す。
 */

/** 内部指示であることの印。この印が付いた発言は画面に表示しない。 */
export const INTERNAL_PREFIX = '[[coach:internal]]';

/** 画像添付の跡。画像そのものは保存しないので、あったことだけを残す。 */
export const IMAGE_MARKER = '[[coach:image]]';

/** 控えの id が付くと `[[coach:image:xxx]]` になるので、判定は前半だけで行う。 */
const IMAGE_MARKER_PREFIX = '[[coach:image';

export function imagePlaceholder(count: number, group?: string): string {
  const tag = group ? `${IMAGE_MARKER_PREFIX}:${group}]]` : IMAGE_MARKER;
  return `${tag} （この発言には画像が${count}枚添付されていました。数値は読み取り済みで、カルテに記録してあります）`;
}

/** マーカー付きテキストから、添付枚数を取り出す。 */
export function attachmentCountOf(text: string): number {
  if (!text.startsWith(IMAGE_MARKER_PREFIX)) return 0;
  const match = text.match(/画像が(\d+)枚/);
  return match ? Number(match[1]) : 1;
}

/**
 * マーカー付きテキストから、見返し用の控えの id を取り出す。
 * 古い記録にはこの id が無い。その場合は枚数だけを出す。
 */
export function attachmentGroupOf(text: string): string | undefined {
  if (!text.startsWith(IMAGE_MARKER_PREFIX)) return undefined;
  const match = text.match(/^\[\[coach:image:([a-zA-Z0-9_-]+)\]\]/);
  return match ? match[1] : undefined;
}
