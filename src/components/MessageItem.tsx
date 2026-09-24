'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { ChatMessage } from '@/lib/types';
import type { ResolvedGear } from '@/lib/gear';
import type { CoachCharacter } from '@/lib/characters';
import RichText from './RichText';
import CoachAvatar from './CoachAvatar';
import MessageActions, { type Feedback } from './MessageActions';

interface Props {
  message: ChatMessage;
  coach: CoachCharacter;
  /** 生成中のカーソルを出すか。 */
  pending?: boolean;
  gear?: ResolvedGear[];
  onOpenImage?: (index: number) => void;
  canSpeak?: boolean;
  speaking?: boolean;
  onToggleSpeak?: () => void;
  feedback?: Feedback;
  onFeedback?: (value: Feedback) => void;
  onRegenerate?: () => void;
  busy?: boolean;
  /** 送信に失敗した発言。薄く出して、やり直せることを示す。 */
  failed?: boolean;
  /** 書き直して送り直せる発言か（直前のユーザー発言だけ）。 */
  canEdit?: boolean;
  /** 書き直した本文で送り直す。 */
  onEdit?: (text: string) => void;
  /** この発言の画像を、もう一度添付欄に戻す。 */
  onReuseImages?: (previews: string[]) => void;
}

/** ユーザーの発言に添える操作。コーチ側より軽く、文字で置く。 */
function UserAction({
  label,
  onClick,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full px-2.5 py-1.5 text-[0.76em] text-muted transition active:scale-95 hover:bg-sunken disabled:opacity-40"
    >
      {label}
    </button>
  );
}

/** 添付画像は横に流す。縦に積むと本文が押し下げられて読めなくなる。 */
function ImageStrip({
  previews,
  onOpen,
}: {
  previews: string[];
  onOpen?: (index: number) => void;
}) {
  const single = previews.length === 1;
  return (
    <div
      className={`scroll-area -mx-4 mb-2 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 ${
        single ? '' : 'pr-8'
      }`}
    >
      {previews.map((preview, index) => (
        <button
          key={preview.slice(-32)}
          type="button"
          onClick={() => onOpen?.(index)}
          aria-label={`送信した画像 ${index + 1} を拡大`}
          className={`shrink-0 snap-start overflow-hidden rounded-[14px] border border-line transition active:scale-[0.97] ${
            single ? 'max-w-[72%]' : ''
          }`}
        >
          {/* 送信済みの縮小画像をそのまま出すだけなので next/image は使わない */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt={`送信した画像 ${index + 1}`}
            className={single ? 'max-h-52 w-auto object-contain' : 'h-32 w-32 object-cover'}
          />
        </button>
      ))}
    </div>
  );
}

/**
 * 1つの発言。
 *
 * 吹き出しを左右に寄せると、スマホの幅では本文が6割ほどしか使えない。
 * 練習メニューや心拍ゾーンの表が入る以上、横幅は全部使う。
 * 誰の発言かは、位置ではなく名前と面の色で示す。
 */
export default function MessageItem({
  message,
  coach,
  pending = false,
  gear,
  onOpenImage,
  canSpeak = false,
  speaking = false,
  onToggleSpeak,
  feedback = null,
  onFeedback,
  onRegenerate,
  busy = false,
  failed = false,
  canEdit = false,
  onEdit,
  onReuseImages,
}: Props) {
  const isUser = message.role === 'user';
  const hasImages = Boolean(message.imagePreviews && message.imagePreviews.length > 0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.text);
  const [copied, setCopied] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  // 書き直しに入ったら、すぐ打てるようにして末尾へカーソルを置く。
  useLayoutEffect(() => {
    if (!editing) return;
    const el = editRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  // 書き直せる対象でなくなったら、開いたままにしない。
  useEffect(() => {
    if (!canEdit) setEditing(false);
  }, [canEdit]);

  if (isUser) {
    return (
      <div className={`animate-rise ${failed ? 'opacity-55' : ''}`}>
        {hasImages && <ImageStrip previews={message.imagePreviews!} onOpen={onOpenImage} />}
        {!hasImages && message.attachmentCount ? (
          <p className="mb-1.5 text-[0.8em] text-muted">
            スクリーンショット{message.attachmentCount}枚を送信
          </p>
        ) : null}

        {editing ? (
          <div className="rounded-[18px] border border-[color:var(--accent)] bg-bg p-2.5">
            <textarea
              ref={editRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="送った文章を書き直す"
              className="scroll-area chat-body max-h-[40dvh] min-h-[72px] w-full resize-none bg-transparent px-1.5 py-1 leading-[1.75] text-fg outline-none"
            />
            <div className="mt-1.5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-full px-3.5 py-2 text-[13px] text-muted"
              >
                やめる
              </button>
              <button
                type="button"
                disabled={busy || !draft.trim()}
                onClick={() => {
                  setEditing(false);
                  onEdit?.(draft);
                }}
                className="rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-[var(--accent-fg)] disabled:opacity-40"
              >
                送り直す
              </button>
            </div>
            {hasImages && (
              <p className="mt-1 px-1.5 text-[0.74em] text-muted">
                添付した{message.imagePreviews!.length}枚は、そのまま一緒に送ります
              </p>
            )}
          </div>
        ) : (
          <>
            {message.text && (
              <div className="chat-body w-full whitespace-pre-wrap break-words rounded-[18px] bg-sunken px-4 py-3 leading-[1.75]">
                {message.text}
              </div>
            )}
            <div className="chat-body mt-1 flex flex-wrap items-center justify-end gap-0.5">
              {message.text && (
                <UserAction
                  label={copied ? 'コピーしました' : 'コピー'}
                  onClick={() => {
                    navigator.clipboard
                      .writeText(message.text)
                      .then(() => setCopied(true))
                      .catch(() => undefined);
                  }}
                />
              )}
              {hasImages && onReuseImages && (
                <UserAction
                  label="画像をもう一度使う"
                  disabled={busy}
                  onClick={() => onReuseImages(message.imagePreviews!)}
                />
              )}
              {canEdit && onEdit && message.text && (
                <UserAction
                  label="書き直して送る"
                  disabled={busy}
                  onClick={() => {
                    setDraft(message.text);
                    setEditing(true);
                  }}
                />
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="animate-rise">
      <div className="mb-1.5 flex items-center gap-2">
        <CoachAvatar character={coach} size={24} />
        <span className="text-[12px] font-semibold text-muted">{coach.name}</span>
      </div>

      <div className="chat-body w-full break-words leading-[1.8]">
        <RichText text={message.text} gear={gear} />
        {pending && <span className="ml-0.5 inline-block animate-blink text-accent">●</span>}
      </div>

      {!pending && message.text.trim().length > 0 && onFeedback && (
        <MessageActions
          text={message.text}
          feedback={feedback}
          onFeedback={onFeedback}
          canSpeak={canSpeak}
          speaking={speaking}
          onToggleSpeak={onToggleSpeak ?? (() => undefined)}
          onRegenerate={onRegenerate ?? (() => undefined)}
          busy={busy}
        />
      )}
    </div>
  );
}
