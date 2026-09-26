/**
 * zip を開く。
 *
 * Garmin の書き出しは zip で降ってきます。
 * 「ファイルのエクスポート」（FIT）も、アカウント全体の一括書き出しも zip です。
 * **zip を開けないと、いちばん価値の高い FIT がそもそも手元に届きません。**
 *
 * そして一括書き出しが開ければ、**1回の操作で全期間の練習が入ります。**
 * 走るたびに1本ずつ書き出す手間は、ここでほぼ消えます。
 *
 * 外部のライブラリは入れません。解凍はブラウザが持っている DecompressionStream に任せます
 * （Safari 16.4 以降・Chrome 80 以降・Node 18 以降）。
 */

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

export interface ZipEntry {
  name: string;
  data: ArrayBuffer;
}

/** 書庫の終わりを示す印。ここから中身の一覧の場所が分かる。 */
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** 一度に取り出すファイル数の上限。数年ぶんの書き出しでも足りる幅。 */
export const MAX_ZIP_ENTRIES = 2000;

/** 終わりの印を、後ろから探す。書庫のコメントがあると末尾から少し前にある。 */
function findEocd(view: DataView): number {
  const max = Math.min(view.byteLength, 0xffff + 22);
  for (let i = 22; i <= max; i += 1) {
    const offset = view.byteLength - i;
    if (offset < 0) break;
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  throw new ZipError('zip ファイルとして読み取れませんでした。');
}

async function inflate(data: Uint8Array, method: number): Promise<ArrayBuffer> {
  // 0 は無圧縮。そのまま返す。
  if (method === 0) return data.slice().buffer;
  if (method !== 8) throw new ZipError('この zip の圧縮方式には対応していません。');

  if (typeof DecompressionStream === 'undefined') {
    throw new ZipError('この端末では zip を開けませんでした。中身を取り出してから選んでください。');
  }

  const stream = new Blob([data.slice() as unknown as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).arrayBuffer();
}

/**
 * zip の中身を取り出す。
 * **名前で絞れるようにする。** 一括書き出しには写真や設定ファイルも入っていて、
 * 全部を展開するとメモリを食うだけになる。
 */
export async function unzip(
  buffer: ArrayBuffer,
  keep: (name: string) => boolean = () => true,
): Promise<ZipEntry[]> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const eocd = findEocd(view);

  const count = view.getUint16(eocd + 10, true);
  const directory = view.getUint32(eocd + 16, true);
  if (count === 0xffff || directory === 0xffffffff) {
    throw new ZipError('この zip は大きすぎて開けませんでした。分けて書き出してください。');
  }

  const entries: ZipEntry[] = [];
  let offset = directory;

  for (let i = 0; i < count && i < MAX_ZIP_ENTRIES; i += 1) {
    if (offset + 46 > buffer.byteLength) break;
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) break;

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;

    // フォルダそのものと、要らないファイルは開かない。
    if (name.endsWith('/') || !keep(name)) continue;
    if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) continue;

    // 中身の始まりは、局所ヘッダ（30バイト）＋名前＋追加領域の後ろ。
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const end = start + compressedSize;
    if (end > buffer.byteLength) continue;

    try {
      entries.push({ name, data: await inflate(bytes.subarray(start, end), method) });
    } catch {
      // 1つ開けなくても、残りは取り出す。全部やり直しにしない。
    }
  }

  return entries;
}

/** 取り込める練習のファイルか。 */
export function isWorkoutFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.includes('__macosx') || lower.startsWith('.')) return false;
  return lower.endsWith('.fit') || lower.endsWith('.tcx') || lower.endsWith('.gpx');
}

export function isZipName(name: string): boolean {
  return name.toLowerCase().endsWith('.zip');
}

/**
 * 中身を見て zip かを判断する。
 * **名前は当てにならない。** 端末やアプリが拡張子を落としたり付け替えたりする。
 */
export function looksLikeZip(data: ArrayBuffer): boolean {
  if (data.byteLength < 4) return false;
  const head = new Uint8Array(data, 0, 2);
  return head[0] === 0x50 && head[1] === 0x4b; // "PK"
}
