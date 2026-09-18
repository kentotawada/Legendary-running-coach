import type { ChatMessage } from '@/lib/types';
import RichText from './RichText';
import type { ResolvedGear } from '@/lib/gear';

interface Props {
  message: ChatMessage;
  /** 生成中のカーソルを出すか。 */
  pending?: boolean;
  /** 道具カードを描くためのカタログ。 */
  gear?: ResolvedGear[];
  /** 添付画像を全画面で開く。 */
  onOpenImage?: (index: number) => void;
  /** 読み上げが使える端末か。 */
  canSpeak?: boolean;
  /** いまこの発言を読み上げているか。 */
  speaking?: boolean;
  onToggleSpeak?: () => void;
}

export default function MessageBubble({
  message,
  pending = false,
  gear,
  onOpenImage,
  canSpeak = false,
  speaking = false,
  onToggleSpeak,
}: Props) {
  const isUser = message.role === 'user';
  // 読み上げは出来上がった文章に対して行う。生成中に押されても途中までしか読めない。
  const showSpeak = !isUser && canSpeak && !pending && message.text.trim().length > 0;

  return (
    <div className={`flex w-full animate-rise ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={[
          'chat-body max-w-[85%] break-words rounded-[var(--radius)] px-4 py-3 leading-[1.75]',
          isUser ? 'whitespace-pre-wrap' : '',
          isUser
            ? 'rounded-br-md bg-[var(--user-bubble)] text-[var(--user-bubble-fg)]'
            : 'rounded-bl-md border border-line bg-[var(--coach-bubble)] text-fg shadow-sm',
        ].join(' ')}
      >
        {message.imagePreviews && message.imagePreviews.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {message.imagePreviews.map((preview, index) => (
              <button
                key={preview.slice(-24)}
                type="button"
                onClick={() => onOpenImage?.(index)}
                aria-label={`送信した画像 ${index + 1} を拡大`}
                className="overflow-hidden rounded-lg border border-line transition active:scale-95"
              >
                {/* 送信済みの縮小画像をそのまま出すだけなので next/image は使わない */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={preview}
                  alt={`送信した画像 ${index + 1}`}
                  className="h-24 w-24 object-cover"
                />
              </button>
            ))}
          </div>
        )}
        {!message.imagePreviews && message.attachmentCount ? (
          <p className="mb-1 text-[0.8em] opacity-70">📷 スクリーンショット{message.attachmentCount}枚を送信</p>
        ) : null}
        {isUser ? message.text : <RichText text={message.text} gear={gear} />}
        {pending && <span className="ml-0.5 inline-block animate-blink text-accent">●</span>}

        {showSpeak && (
          <button
            type="button"
            onClick={onToggleSpeak}
            aria-label={speaking ? '読み上げを止める' : 'この返答を読み上げる'}
            className={[
              'mt-2 flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[0.76em] transition active:scale-95',
              speaking ? 'border-[color:var(--accent)] bg-accent-soft text-accent' : 'border-line text-muted',
            ].join(' ')}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M11 5 6 9H3v6h3l5 4z" />
              {speaking ? <path d="M17 7v10" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7" />}
            </svg>
            {speaking ? '停止' : '読み上げ'}
          </button>
        )}
      </div>
    </div>
  );
}
