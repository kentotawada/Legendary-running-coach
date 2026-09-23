'use client';

import { useState } from 'react';
import type { CoachCharacter } from '@/lib/characters';

/**
 * コーチの顔。
 * 写真が読めない時（通信が細い、画像を消した）でも名前は分かるよう、
 * 姓の頭文字に落として、空白の丸を出さないようにしている。
 */
export default function CoachAvatar({
  character,
  size = 40,
  ring = false,
}: {
  character: CoachCharacter;
  size?: number;
  /** 選択中であることを示す縁取り。 */
  ring?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <span
      className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-sunken"
      style={{
        width: size,
        height: size,
        boxShadow: ring ? `0 0 0 2px var(--bg), 0 0 0 4px ${character.color}` : undefined,
      }}
    >
      {failed ? (
        <span
          aria-hidden="true"
          className="font-semibold"
          style={{ color: character.color, fontSize: Math.round(size * 0.42) }}
        >
          {character.initial}
        </span>
      ) : (
        // 静的な正方形の顔写真をそのまま出すだけなので next/image は使わない
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={character.photo}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
          loading="lazy"
          decoding="async"
        />
      )}
    </span>
  );
}
