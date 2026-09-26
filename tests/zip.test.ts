import { describe, expect, it } from 'vitest';
import { ZipError, isWorkoutFile, isZipName, unzip } from '@/lib/zip';

/**
 * zip を**書く**側をここで用意して、読む側を確かめる。
 * Garmin の書き出しは zip で降ってくるので、ここが開けないと FIT が手元に届かない。
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes.slice() as unknown as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface FileSpec {
  name: string;
  data: Uint8Array;
  /** 圧縮するか。0 = そのまま、8 = deflate。 */
  method?: 0 | 8;
}

async function buildZip(files: FileSpec[]): Promise<ArrayBuffer> {
  const out: number[] = [];
  const u16 = (v: number) => out.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v: number) => out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  const central: { name: Uint8Array; method: number; crc: number; size: number; raw: number; at: number }[] = [];

  for (const file of files) {
    const method = file.method ?? 8;
    const body = method === 0 ? file.data : await deflate(file.data);
    const name = new TextEncoder().encode(file.name);
    const at = out.length;

    u32(0x04034b50);
    u16(20);
    u16(0);
    u16(method);
    u16(0);
    u16(0);
    u32(crc32(file.data));
    u32(body.length);
    u32(file.data.length);
    u16(name.length);
    u16(0);
    out.push(...name, ...body);

    central.push({ name, method, crc: crc32(file.data), size: body.length, raw: file.data.length, at });
  }

  const directoryAt = out.length;
  for (const entry of central) {
    u32(0x02014b50);
    u16(20);
    u16(20);
    u16(0);
    u16(entry.method);
    u16(0);
    u16(0);
    u32(entry.crc);
    u32(entry.size);
    u32(entry.raw);
    u16(entry.name.length);
    u16(0);
    u16(0);
    u16(0);
    u16(0);
    u32(0);
    u32(entry.at);
    out.push(...entry.name);
  }
  const directorySize = out.length - directoryAt;

  u32(0x06054b50);
  u16(0);
  u16(0);
  u16(central.length);
  u16(central.length);
  u32(directorySize);
  u32(directoryAt);
  u16(0);

  return new Uint8Array(out).buffer;
}

const bytes = (text: string) => new TextEncoder().encode(text);
const decode = (data: ArrayBuffer) => new TextDecoder().decode(data);

describe('zip を開く', () => {
  it('圧縮された中身を取り出す', async () => {
    const zip = await buildZip([{ name: 'activity.tcx', data: bytes('<TrainingCenterDatabase/>') }]);
    const entries = await unzip(zip);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('activity.tcx');
    expect(decode(entries[0].data)).toBe('<TrainingCenterDatabase/>');
  });

  it('無圧縮で入っている中身も取り出す', async () => {
    const zip = await buildZip([{ name: '12345.fit', data: bytes('not really a fit'), method: 0 }]);
    const entries = await unzip(zip);
    expect(decode(entries[0].data)).toBe('not really a fit');
  });

  it('複数の中身を、名前ごと取り出す', async () => {
    const zip = await buildZip([
      { name: 'a.fit', data: bytes('one') },
      { name: 'b.tcx', data: bytes('two') },
      { name: 'c.gpx', data: bytes('three') },
    ]);
    const entries = await unzip(zip);
    expect(entries.map((entry) => entry.name)).toEqual(['a.fit', 'b.tcx', 'c.gpx']);
  });

  /**
   * 一括書き出しには写真も設定ファイルも入っている。
   * 全部を展開すると、要らないものでメモリを食うだけになる。
   */
  it('要らないファイルは開かない', async () => {
    const zip = await buildZip([
      { name: 'run.fit', data: bytes('keep me') },
      { name: 'photo.jpg', data: bytes('x'.repeat(500)) },
      { name: 'settings.json', data: bytes('{}') },
    ]);
    const entries = await unzip(zip, isWorkoutFile);
    expect(entries.map((entry) => entry.name)).toEqual(['run.fit']);
  });

  it('フォルダの中のファイルも取り出す', async () => {
    const zip = await buildZip([{ name: 'DI_CONNECT/uploaded/2026-09-22.fit', data: bytes('deep') }]);
    const entries = await unzip(zip, isWorkoutFile);
    expect(entries).toHaveLength(1);
    expect(decode(entries[0].data)).toBe('deep');
  });

  it('zip でないものは、そう言う', async () => {
    await expect(unzip(bytes('こんにちは').buffer as ArrayBuffer)).rejects.toBeInstanceOf(ZipError);
  });

  it('空に近いものでも落ちない', async () => {
    await expect(unzip(new Uint8Array(4).buffer)).rejects.toBeInstanceOf(ZipError);
  });
});

describe('ファイルの見分け', () => {
  it('練習のファイルだけを通す', () => {
    expect(isWorkoutFile('12345.fit')).toBe(true);
    expect(isWorkoutFile('activity.TCX')).toBe(true);
    expect(isWorkoutFile('run.gpx')).toBe(true);
    expect(isWorkoutFile('photo.jpg')).toBe(false);
    expect(isWorkoutFile('__MACOSX/._run.fit')).toBe(false);
  });

  it('zip を見分ける', () => {
    expect(isZipName('export.ZIP')).toBe(true);
    expect(isZipName('run.fit')).toBe(false);
  });
});
