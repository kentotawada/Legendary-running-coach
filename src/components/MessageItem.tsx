'use client';

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
}: Props) {
  const isUser = message.role === 'user';
  const hasImages = Boolean(message.imagePreviews && message.imagePreviews.length > 0);

  if (isUser) {
    return (
      <div className={`animate-rise ${failed ? 'opacity-55' : ''}`}>
        {hasImages && <ImageStrip previews={message.imagePreviews!} onOpen={onOpenImage} />}
        {!hasImages && message.attachmentCount ? (
          <p className="mb-1.5 text-[0.8em] text-muted">
            スクリーンショット{message.attachmentCount}枚を送信
          </p>
        ) : null}
        {message.text && (
          <div className="chat-body w-full whitespace-pre-wrap break-words rounded-[18px] bg-sunken px-4 py-3 leading-[1.75]">
            {message.text}
          </div>
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
