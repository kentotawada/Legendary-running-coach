'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { dataUrlToFile, prepareImages, reattachName, type PreparedImage } from '@/lib/downscale';
import { FILE_ACCEPT, MAX_IMAGES, MAX_TOTAL_BYTES, looksLikeImage } from '@/lib/images';
import { useVoiceInput } from '@/hooks/useSpeech';

export interface ComposerApi {
  /** クイックボタンからも画像選択を開けるようにする。 */
  openPicker: () => void;
  /** 相談アイデアから質問文を差し込む。送信はせず、書き換えられる状態で置く。 */
  setText: (text: string) => void;
  /** 前に送った画像を、もう一度添付欄に戻す。 */
  attachAgain: (previews: string[]) => void;
}

interface Props {
  onSend: (text: string, images: PreparedImage[]) => void;
  onError: (message: string) => void;
  /** 何を聞けばいいか分からない時の相談例。 */
  onOpenIdeas?: () => void;
  /** 時計から書き出した記録ファイル（FIT / TCX / GPX / zip）を取り込む。 */
  onImportFiles?: (files: File[]) => void;
  apiRef?: { current: ComposerApi | null };
  disabled?: boolean;
}

const MAX_HEIGHT = 140;

export default function Composer({
  onSend,
  onError,
  onOpenIdeas,
  onImportFiles,
  apiRef,
  disabled = false,
}: Props) {
  const recordRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  // 元のファイルも持っておく。枚数が変わるたびに圧縮率を計算し直すため。
  const [files, setFiles] = useState<File[]>([]);
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** 「＋」とその中身。外を触った時だけ閉じるために使う。 */
  const menuRef = useRef<HTMLDivElement>(null);
  // 話し始めた時点の文面。認識結果はこの後ろに足す。書きかけを消さないため。
  const dictationBase = useRef('');

  const voice = useVoiceInput((text) => {
    const base = dictationBase.current;
    setValue(base ? `${base.replace(/\s*$/, '')} ${text}` : text);
  });

  const toggleVoice = () => {
    if (voice.listening) {
      voice.stop();
      return;
    }
    dictationBase.current = value;
    voice.start();
  };

  if (apiRef) {
    apiRef.current = {
      openPicker: () => fileRef.current?.click(),
      attachAgain: (previews) => {
        const restored = previews
          .map((preview, index) => dataUrlToFile(preview, reattachName(index, preview)))
          .filter((file): file is File => file !== null);
        if (restored.length === 0) {
          onError('この画像はもう一度添付できませんでした。');
          return;
        }
        void addFiles(restored);
      },
      setText: (text) => {
        setValue(text);
        // 差し込んだ直後に、続きを書き足せる位置へカーソルを置く。
        requestAnimationFrame(() => {
          const el = textRef.current;
          if (!el) return;
          el.focus();
          el.setSelectionRange(text.length, text.length);
        });
      },
    };
  }

  /**
   * 貼り付け。
   * スクリーンショットを撮ってそのまま貼る、が一番短い道なのに、
   * これが無いと一度ファイルに保存させることになる。
   */
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (disabled) return;
      const items = Array.from(event.clipboardData?.items ?? []);
      const pictures = items
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file) && looksLikeImage(file!));
      if (pictures.length === 0) return;
      // 画像が入っていた時だけ、本文への貼り付けを止める。
      event.preventDefault();
      void addFiles(pictures);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    // files が変わると枚数の上限判定が変わるので、その都度張り直す。
  }, [disabled, files]);

  /**
   * メニューの外を触ったら閉じる。
   *
   * **メニューの中は対象外にすること。** 中まで閉じてしまうと、
   * スマホでは touchstart の時点でメニューごと消え、
   * 続く click が届かなくなる（＝押しても何も起きない）。
   */
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent | TouchEvent) => {
      if (menuRef.current?.contains(event.target as Node | null)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [menuOpen]);

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
      const { images: prepared, failed, accepted } = await prepareImages(nextFiles);
      const total = prepared.reduce((sum, image) => sum + image.bytes, 0);
      if (total > MAX_TOTAL_BYTES) {
        onError('画像の合計サイズが大きすぎます。枚数を減らすか、何回かに分けて送ってください。');
        return;
      }
      setFiles(accepted);
      setImages(prepared);
      if (failed.length > 0) {
        onError(
          `${failed.join('、')} は、この端末で開けない形式でした。` +
            'スクリーンショットを撮り直すか、JPEG か PNG で保存し直して送ってください。',
        );
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : '画像を読み込めませんでした。');
    } finally {
      setPreparing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  /**
   * 受け取ったファイルを足す。
   * 画像でないものが混ざっていた時に黙って無視すると、
   * 「貼り付けたのに何も起きない」という一番困る状態になる。必ず理由を言う。
   */
  const addFiles = async (incoming: File[] | FileList | null) => {
    const all = incoming ? Array.from(incoming) : [];
    if (all.length === 0) return;

    const pictures = all.filter((file) => looksLikeImage(file));
    const rejected = all.length - pictures.length;
    if (pictures.length === 0) {
      onError(
        rejected === 1
          ? `「${all[0].name || 'このファイル'}」は画像ではないため送れません。練習画面のスクリーンショットを送ってください。`
          : '画像ではないファイルは送れません。練習画面のスクリーンショットを送ってください。',
      );
      return;
    }
    if (rejected > 0) {
      onError(`画像以外の${rejected}件は送れないため、外しました。`);
    }

    const room = MAX_IMAGES - files.length;
    if (room <= 0) {
      onError(`画像は一度に${MAX_IMAGES}枚までです。`);
      return;
    }
    const dropped = pictures.length - room;
    if (dropped > 0) onError(`画像は一度に${MAX_IMAGES}枚までです。${dropped}枚は追加されませんでした。`);
    await rebuild([...files, ...pictures.slice(0, room)]);
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
    <div
      className={`relative px-4 pb-2 pt-2 ${dragging ? 'bg-accent-soft' : ''}`}
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        if (!dragging) setDragging(true);
      }}
      onDragLeave={(e) => {
        // 子要素をまたぐ時にも leave が飛ぶ。外に出た時だけ解除する。
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragging(false);
      }}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragging(false);
        void addFiles(e.dataTransfer?.files ?? null);
      }}
    >
      {dragging && (
        <p className="mb-2 rounded-xl border border-dashed border-[color:var(--accent)] py-3 text-center text-[13px] text-accent">
          ここに落とすと画像を添付します
        </p>
      )}
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

      {voice.listening && (
        <p className="mb-2 text-[12px] text-accent">聞いています… 話し終えたらマイクをもう一度押してください</p>
      )}
      {voice.error && !voice.listening && <p className="mb-2 text-[12px] text-warn">{voice.error}</p>}

      <div className="flex items-end gap-1.5">
        <input
          ref={fileRef}
          type="file"
          accept={FILE_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => void addFiles(e.target.files)}
        />
        {/*
          accept は付けない。iOS の「ファイル」は、拡張子から種類を引けないものを
          選べない状態にしてしまう。.tcx も .fit も、その登録が無い。
        */}
        <input
          ref={recordRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            if (files.length > 0) onImportFiles?.(files);
          }}
        />
        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            disabled={disabled || preparing}
            aria-label="追加する"
            aria-expanded={menuOpen}
            className={`flex h-[46px] w-[46px] items-center justify-center rounded-full border border-line transition active:scale-95 disabled:opacity-40 ${
              menuOpen ? 'bg-accent-soft text-accent' : 'bg-elevated text-fg'
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>

          {menuOpen && (
            <div className="absolute bottom-[54px] left-0 z-20 w-56 overflow-hidden rounded-[14px] border border-line bg-elevated py-1 shadow-[0_10px_30px_rgba(0,0,0,0.16)]">
              {/*
                時計の記録ファイルを、いちばん上に置く。
                入る情報がいちばん多い道なので、探させない。
                スクリーンショットの道は、そのすぐ下に残す。
              */}
              {onImportFiles && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    recordRef.current?.click();
                  }}
                  className="flex w-full items-center gap-2.5 px-4 py-3 text-left active:bg-sunken"
                >
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="13" r="7" />
                    <path d="M12 9.5V13l2.2 1.6" />
                    <path d="M9 2h6M9.5 5.2 10 2.4M14.5 5.2 14 2.4" />
                  </svg>
                  <span className="min-w-0">
                    <span className="block text-[14px]">時計の記録を送る</span>
                    <span className="block text-[11px] text-muted">FIT / TCX / GPX / zip</span>
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  fileRef.current?.click();
                }}
                className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-[14px] active:bg-sunken"
              >
                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="16" rx="3" />
                  <circle cx="8.5" cy="9.5" r="1.6" />
                  <path d="m4 17 4.5-4.5a2 2 0 0 1 2.8 0L16 17" />
                </svg>
                練習データの画像を送る
              </button>
              {onOpenIdeas && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenIdeas();
                  }}
                  className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-[14px] active:bg-sunken"
                >
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 18h6" />
                    <path d="M10 21h4" />
                    <path d="M12 3a6 6 0 0 0-3.6 10.8c.5.4.8.9.9 1.5l.1.7h5.2l.1-.7c.1-.6.4-1.1.9-1.5A6 6 0 0 0 12 3z" />
                  </svg>
                  何を相談するか迷ったら
                </button>
              )}
            </div>
          )}
        </div>

        {voice.supported && (
          <button
            type="button"
            onClick={toggleVoice}
            disabled={disabled}
            aria-label={voice.listening ? '音声入力を止める' : '音声で入力する'}
            aria-pressed={voice.listening}
            className={[
              'flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full border transition active:scale-95 disabled:opacity-40',
              voice.listening
                ? 'animate-blink border-[color:var(--accent)] bg-accent text-[var(--accent-fg)]'
                : 'border-line bg-elevated text-fg',
            ].join(' ')}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0" />
              <path d="M12 18v3" />
            </svg>
          </button>
        )}

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
          className="scroll-area chat-input max-h-[140px] min-h-[46px] min-w-0 flex-1 resize-none rounded-[22px] border border-line bg-elevated px-4 py-3 leading-relaxed text-fg outline-none placeholder:text-muted focus:border-[color:var(--accent)] disabled:opacity-60"
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
