'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { prepareImages, type PreparedImage } from '@/lib/downscale';
import { MAX_IMAGES, MAX_TOTAL_BYTES } from '@/lib/images';

export interface ComposerApi {
  /** クイックボタンからも画像選択を開けるようにする。 */
  openPicker: () => void;
}

interface Props {
  onSend: (text: string, images: PreparedImage[]) => void;
  onError: (message: string) => void;
  apiRef?: { current: ComposerApi | null };
  disabled?: boolean;
}

const MAX_HEIGHT = 140;

export default function Composer({ onSend, onError, apiRef, disabled = false }: Props) {
  const [value, setValue] = useState('');
  // 元のファイルも持っておく。枚数が変わるたびに圧縮率を計算し直すため。
  const [files, setFiles] = useState<File[]>([]);
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [preparing, setPreparing] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (apiRef) apiRef.current = { openPicker: () => fileRef.current?.click() };

  // 入力量に合わせて高さを伸ばす。上限を超えたら中でスクロールさせる。
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  /**
   * 枚数が決まってから圧縮する。
   * 10枚送る時と1枚送る時では、1枚に割ける容量が10倍違うため、
   * 追加・削除のたびに全部作り直している。
   */
  const rebuild = async (nextFiles: File[]) => {
    setPreparing(true);
    try {
      const prepared = await prepareImages(nextFiles);
      const total = prepared.reduce((sum, image) => sum + image.bytes, 0);
      if (total > MAX_TOTAL_BYTES) {
        onError('画像の合計サイズが大きすぎます。枚数を減らすか、何回かに分けて送ってください。');
        return;
      }
      setFiles(nextFiles);
      setImages(prepared);
    } catch (error) {
      onError(error instanceof Error ? error.message : '画像を読み込めませんでした。');
    } finally {
      setPreparing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const addFiles = async (selected: FileList | null) => {
    if (!selected || selected.length === 0) return;
    const room = MAX_IMAGES - files.length;
    if (room <= 0) {
      onError(`画像は一度に${MAX_IMAGES}枚までです。`);
      return;
    }
    const dropped = selected.length - room;
    if (dropped > 0) onError(`画像は一度に${MAX_IMAGES}枚までです。${dropped}枚は追加されませんでした。`);
    await rebuild([...files, ...Array.from(selected).slice(0, room)]);
  };

  const submit = () => {
    const text = value.trim();
    if (disabled || preparing) return;
    if (!text && images.length === 0) return;
    setValue('');
    setFiles([]);
    setImages([]);
    onSend(text, images);
  };

  const canSend = !disabled && !preparing && (value.trim().length > 0 || images.length > 0);

  return (
    <div className="px-4 pb-2">
      {images.length > 0 && (
        <p className="mb-1.5 text-[12px] text-muted">
          {images.length} / {MAX_IMAGES} 枚
        </p>
      )}

      {images.length > 0 && (
        <div className="scroll-area mb-2 flex gap-2 overflow-x-auto pt-1.5">
          {images.map((image, index) => (
            <div key={image.preview.slice(-24)} className="relative shrink-0">
              {/* 縮小済みの data URL を出すだけなので next/image は使わない */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.preview}
                alt={`添付画像 ${index + 1}`}
                className="h-20 w-20 rounded-xl border border-line object-cover"
              />
              <button
                type="button"
                aria-label={`添付画像 ${index + 1} を外す`}
                onClick={() => void rebuild(files.filter((_, i) => i !== index))}
                className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--user-bubble)] text-[13px] text-[var(--user-bubble-fg)]"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {preparing && <p className="mb-2 text-[12px] text-muted">画像を準備しています…</p>}

      <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => void addFiles(e.target.files)}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || preparing}
          aria-label="スクリーンショットを添付"
          className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full border border-line bg-elevated text-fg transition active:scale-95 disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <circle cx="8.5" cy="9.5" r="1.6" />
            <path d="m4 17 4.5-4.5a2 2 0 0 1 2.8 0L16 17" />
            <path d="m14 15 1.8-1.8a2 2 0 0 1 2.8 0L20 14.6" />
          </svg>
        </button>

        <textarea
          ref={textRef}
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // スマホでは Enter は改行。送信はボタン、PC では ⌘/Ctrl + Enter。
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="今日の練習と体の状態を"
          aria-label="コーチへのメッセージ"
          className="scroll-area max-h-[140px] min-h-[46px] flex-1 resize-none rounded-[var(--radius)] border border-line bg-elevated px-4 py-3 leading-relaxed text-fg outline-none placeholder:text-muted focus:border-[color:var(--accent)] disabled:opacity-60"
        />

        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          aria-label="送信"
          className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full bg-accent text-[var(--accent-fg)] transition active:scale-95 disabled:opacity-35"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 19V5" />
            <path d="m5 12 7-7 7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
