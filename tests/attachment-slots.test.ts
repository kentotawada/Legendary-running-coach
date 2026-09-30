import { describe, expect, it } from 'vitest';
import {
  buildAttachments,
  emptyAttachments,
  removeAt,
  slotsFor,
  type Attachments,
} from '@/lib/attachment-slots';

/**
 * 添付欄の「×」。
 *
 * ここが壊れていた。縦に長いスクリーンショットは複数枚へ切り分けられるので、
 * ファイル1つに対して画像が3枚並ぶ。それなのに × が「画像の並びの n 番目」で
 * files を外そうとしていたため、**2枚目・3枚目の × を押しても何も起きなかった。**
 * 長い画面を送るのはこのアプリの主な使い方なので、いちばん踏まれる道だった。
 */

/** 長い画像1つ（3枚に分割）＋ふつうの画像1つ、を作る。 */
function sample(): { files: string[]; images: string[]; owners: number[] } {
  return {
    files: ['長い.png', 'ふつう.png'],
    images: ['長い:0', '長い:1', '長い:2', 'ふつう:0'],
    owners: [0, 0, 0, 1],
  };
}

function build(dropped: Record<string, number[]> = {}): Attachments<string, string> {
  const { files, images, owners } = sample();
  return buildAttachments(files, images, owners, (file, tile) =>
    (dropped[file] ?? []).includes(tile),
  );
}

describe('slotsFor', () => {
  it('ファイルごとに通し番号を振る', () => {
    expect(slotsFor([0, 0, 0, 1])).toEqual([
      { owner: 0, tile: 0 },
      { owner: 0, tile: 1 },
      { owner: 0, tile: 2 },
      { owner: 1, tile: 0 },
    ]);
  });

  it('番号は並びの位置ではなく、出どころの中で数える', () => {
    // 交互に来ても、それぞれのファイルの中で 0,1,2 と進む。
    expect(slotsFor([0, 1, 0, 1]).map((slot) => slot.tile)).toEqual([0, 0, 1, 1]);
  });

  it('空でも落ちない', () => {
    expect(slotsFor([])).toEqual([]);
  });
});

describe('buildAttachments', () => {
  it('切り分けた画像に、正しい出どころが付く', () => {
    const state = build();
    expect(state.images).toHaveLength(4);
    expect(state.files).toHaveLength(2);
    expect(state.slots).toEqual([
      { owner: 0, tile: 0 },
      { owner: 0, tile: 1 },
      { owner: 0, tile: 2 },
      { owner: 1, tile: 0 },
    ]);
  });

  it('外した1枚は、作り直しても戻ってこない', () => {
    const state = build({ '長い.png': [1] });
    expect(state.images).toEqual(['長い:0', '長い:2', 'ふつう:0']);
    // ファイルはまだ2つとも生きている。
    expect(state.files).toEqual(['長い.png', 'ふつう.png']);
  });

  it('全部外したファイルは、ファイルごと消える', () => {
    const state = build({ '長い.png': [0, 1, 2] });
    expect(state.files).toEqual(['ふつう.png']);
    expect(state.images).toEqual(['ふつう:0']);
    // 残った画像の owner が詰められている。詰めないと次の × がずれる。
    expect(state.slots).toEqual([{ owner: 0, tile: 0 }]);
  });

  it('前のファイルが消えた分だけ、後ろの owner を詰める', () => {
    const state = buildAttachments(
      ['a', 'b', 'c'],
      ['a0', 'b0', 'b1', 'c0'],
      [0, 1, 1, 2],
      (file) => file === 'a',
    );
    expect(state.files).toEqual(['b', 'c']);
    expect(state.slots).toEqual([
      { owner: 0, tile: 0 },
      { owner: 0, tile: 1 },
      { owner: 1, tile: 0 },
    ]);
  });

  it('出どころが分からない画像は、黙って捨てない', () => {
    // owners が足りない（想定外）。消えるより残るほうがまし。
    const state = buildAttachments(['a'], ['a0', 'a1'], [0], () => false);
    expect(state.images).toHaveLength(2);
  });
});

describe('removeAt', () => {
  it('切り分けた2枚目の × で、2枚目だけが消える', () => {
    const { next, file, tile, fileRemoved } = removeAt(build(), 1);
    expect(next.images).toEqual(['長い:0', '長い:2', 'ふつう:0']);
    expect(file).toBe('長い.png');
    expect(tile).toBe(1);
    // まだ1枚目と3枚目が残っているので、ファイルは残す。
    expect(fileRemoved).toBe(false);
    expect(next.files).toEqual(['長い.png', 'ふつう.png']);
  });

  it('最後の1枚を外すと、ファイルごと消える', () => {
    const { next, fileRemoved } = removeAt(build(), 3);
    expect(fileRemoved).toBe(true);
    expect(next.files).toEqual(['長い.png']);
    expect(next.images).toEqual(['長い:0', '長い:1', '長い:2']);
  });

  it('続けて押しても、押した1枚だけが消えていく', () => {
    let state = build();
    // 3枚に分かれた真ん中を外し、そのあと先頭を外す。
    state = removeAt(state, 1).next;
    state = removeAt(state, 0).next;
    expect(state.images).toEqual(['長い:2', 'ふつう:0']);
    expect(state.files).toEqual(['長い.png', 'ふつう.png']);
    // tile の番号は元のまま。ここがずれると、次の作り直しで別の1枚が消える。
    expect(state.slots).toEqual([
      { owner: 0, tile: 2 },
      { owner: 1, tile: 0 },
    ]);
  });

  it('どの位置から外しても、残りの出どころが実在するファイルを指す', () => {
    for (let start = 0; start < 4; start += 1) {
      let state = build();
      state = removeAt(state, start).next;
      for (const slot of state.slots) {
        expect(state.files[slot.owner], `${start} を外したあと`).toBeDefined();
      }
      expect(state.slots).toHaveLength(state.images.length);
    }
  });

  it('全部外すと空になる', () => {
    let state = build();
    while (state.images.length > 0) state = removeAt(state, 0).next;
    expect(state).toEqual(emptyAttachments());
  });

  it('無い位置を指されても、状態を壊さない', () => {
    const state = build();
    const { next, file } = removeAt(state, 9);
    expect(file).toBeNull();
    expect(next).toBe(state);
  });

  /**
   * 同じ画像を2回添付できる（「画像をもう一度使う」を2回押す）。
   * 中身が同じでも、出どころが違えば別の1枚として外せること。
   */
  it('同じ中身が2枚並んでも、押したほうだけが消える', () => {
    const state = buildAttachments(
      ['同じ.png', '同じ.png'],
      ['同じ:0', '同じ:0'],
      [0, 1],
      () => false,
    );
    expect(state.slots).toEqual([
      { owner: 0, tile: 0 },
      { owner: 1, tile: 0 },
    ]);
    const { next } = removeAt(state, 0);
    expect(next.images).toEqual(['同じ:0']);
    expect(next.files).toEqual(['同じ.png']);
    expect(next.slots).toEqual([{ owner: 0, tile: 0 }]);
  });
});
