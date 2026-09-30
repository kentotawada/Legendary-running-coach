/**
 * 添付欄の中身の持ち方。
 *
 * **ファイルと表示されている画像は 1:1 ではない。**
 * 縦に長い画像は、読める大きさを保つために複数枚へ切り分けるので、
 * 1ファイルから最大6枚が出る（downscale.ts の tilesFor）。
 *
 * この対応を持たずに「画像の並びの n 番目」で files を操作すると、
 * 長いスクリーンショットを1枚添付した時に files.length が 1 のまま
 * 画像だけ3枚並び、2枚目の × が files の2番目（無い）を外そうとして、
 * **押しても何も起きない**。実際にそうなっていた。
 */

/** 画像1枚の出どころ。 */
export interface Slot {
  /** 何番目のファイルから出たか。 */
  owner: number;
  /** そのファイルの中で何枚目か。**並びの中での位置ではない。** */
  tile: number;
}

export interface Attachments<F, I> {
  files: F[];
  images: I[];
  /** images と同じ長さ・同じ並び。 */
  slots: Slot[];
}

export function emptyAttachments<F, I>(): Attachments<F, I> {
  return { files: [], images: [], slots: [] };
}

/**
 * 出どころの一覧から、ファイルごとの通し番号を振る。
 *
 * 外した1枚を、枚数が変わって作り直したあとも同じ1枚として扱うために要る。
 * 並びの中での位置では駄目で、その出どころの中での通し番号でなければ、
 * 1枚外したあとに番号がずれて、次は別の1枚が消える。
 */
export function slotsFor(owners: number[]): Slot[] {
  const seen = new Map<number, number>();
  return owners.map((owner) => {
    const tile = seen.get(owner) ?? 0;
    seen.set(owner, tile + 1);
    return { owner, tile };
  });
}

/**
 * 作り直した結果に、外した1枚の控えを反映して組み立てる。
 *
 * 1枚も残らなかったファイルは、ファイルごと落とす。
 * 落とした分だけ owner を詰め直すので、呼ぶ側は番号を気にしなくてよい。
 */
export function buildAttachments<F, I>(
  files: F[],
  images: I[],
  owners: number[],
  isDropped: (file: F, tile: number) => boolean,
): Attachments<F, I> {
  const slots = slotsFor(owners);
  const kept: { image: I; slot: Slot }[] = [];

  images.forEach((image, index) => {
    const slot = slots[index];
    const file = slot ? files[slot.owner] : undefined;
    // 出どころが分からない1枚は、黙って捨てずに残す（owner 0 として扱う）。
    if (!slot || file === undefined) {
      kept.push({ image, slot: slot ?? { owner: 0, tile: index } });
      return;
    }
    if (isDropped(file, slot.tile)) return;
    kept.push({ image, slot });
  });

  const alive = files.filter((_, index) => kept.some((item) => item.slot.owner === index));
  const moved = new Map<number, number>();
  let next = 0;
  files.forEach((_, index) => {
    if (kept.some((item) => item.slot.owner === index)) {
      moved.set(index, next);
      next += 1;
    }
  });

  return {
    files: alive,
    images: kept.map((item) => item.image),
    slots: kept.map((item) => ({ owner: moved.get(item.slot.owner) ?? 0, tile: item.slot.tile })),
  };
}

export interface Removal<F, I> {
  next: Attachments<F, I>;
  /** 外した1枚の出どころ。作り直した時に戻さないよう控えるために返す。 */
  file: F | null;
  tile: number;
  /** そのファイルの最後の1枚だったか。控えごと捨ててよい。 */
  fileRemoved: boolean;
}

/**
 * 1枚だけ外す。
 *
 * **作り直さない。** 圧縮し直すと一瞬止まるし、外せば合計は必ず減るので
 * 作り直す理由が無い。押した瞬間に消えることのほうが大事。
 */
export function removeAt<F, I>(state: Attachments<F, I>, index: number): Removal<F, I> {
  const slot = state.slots[index];
  const file = slot ? state.files[slot.owner] : undefined;
  if (!slot || file === undefined) {
    return { next: state, file: null, tile: -1, fileRemoved: false };
  }

  const keep = (_: unknown, i: number) => i !== index;
  const images = state.images.filter(keep);
  const slots = state.slots.filter(keep);
  const fileRemoved = !slots.some((item) => item.owner === slot.owner);

  if (!fileRemoved) {
    return { next: { files: state.files, images, slots }, file, tile: slot.tile, fileRemoved };
  }

  return {
    next: {
      files: state.files.filter((_, i) => i !== slot.owner),
      images,
      // 落としたファイルより後ろの番号を詰める。
      slots: slots.map((item) => ({
        ...item,
        owner: item.owner > slot.owner ? item.owner - 1 : item.owner,
      })),
    },
    file,
    tile: slot.tile,
    fileRemoved,
  };
}
