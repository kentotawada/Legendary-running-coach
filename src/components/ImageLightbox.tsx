'use client';

import { useEffect, useState } from 'react';

interface Props {
  images: string[];
  startIndex: number;
  onClose: () => void;
}

/**
 * 送った画像を大きく見返すための全画面表示。
 * 添付欄のサムネイルは 80px しかなく、読み取り結果が正しいか確かめようがない。
 */
export default function ImageLightbox({ images, startIndex, onClose }: Props) {
  const [index, setIndex] = useState(Math.min(Math.max(startIndex, 0), images.length - 1));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, images.length - 1));
      if (event.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [images.length, onClose]);

  // 背面のチャットがスクロールしてしまわないようにする。
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (images.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/95"
      role="dialog"
      aria-modal="true"
      aria-label="送信した画像"
    >
      <div className="safe-top flex items-center justify-between px-4 pb-2 text-white">
        <span className="text-[13px] tabular-nums opacity-80">
          {index + 1} / {images.length}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-white/30 px-3.5 py-2 text-[13px] active:scale-95"
        >
          閉じる
        </button>
      </div>

      {/* 画像の外側を押したら閉じる。スマホでは一番押しやすい場所。 */}
      <button
        type="button"
        onClick={onClose}
        aria-label="閉じる"
        className="flex min-h-0 flex-1 items-center justify-center px-2"
      >
        {/* 送信済みの data URL をそのまま出すだけなので next/image は使わない */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={images[index]}
          alt={`送信した画像 ${index + 1}`}
          className="max-h-full max-w-full object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      </button>

      {images.length > 1 && (
        <div className="safe-bottom flex items-center justify-center gap-3 px-4 pt-2">
          <button
            type="button"
            onClick={() => setIndex((i) => Math.max(i - 1, 0))}
            disabled={index === 0}
            className="rounded-full border border-white/30 px-5 py-2.5 text-[14px] text-white disabled:opacity-30"
          >
            前へ
          </button>
          <button
            type="button"
            onClick={() => setIndex((i) => Math.min(i + 1, images.length - 1))}
            disabled={index === images.length - 1}
            className="rounded-full border border-white/30 px-5 py-2.5 text-[14px] text-white disabled:opacity-30"
          >
            次へ
          </button>
        </div>
      )}
    </div>
  );
}
