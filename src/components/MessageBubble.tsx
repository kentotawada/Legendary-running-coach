import type { ChatMessage } from '@/lib/types';
import RichText from './RichText';
import type { ResolvedGear } from '@/lib/gear';

interface Props {
  message: ChatMessage;
  /** 生成中のカーソルを出すか。 */
  pending?: boolean;
  /** 道具カードを描くためのカタログ。 */
  gear?: ResolvedGear[];
}

export default function MessageBubble({ message, pending = false, gear }: Props) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex w-full animate-rise ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={[
          'max-w-[85%] break-words rounded-[var(--radius)] px-4 py-3 text-[15px] leading-[1.75]',
          isUser ? 'whitespace-pre-wrap' : '',
          isUser
            ? 'rounded-br-md bg-[var(--user-bubble)] text-[var(--user-bubble-fg)]'
            : 'rounded-bl-md border border-line bg-[var(--coach-bubble)] text-fg shadow-sm',
        ].join(' ')}
      >
        {message.imagePreviews && message.imagePreviews.length > 0 && (
          <div className="mb-2 flex gap-2">
            {message.imagePreviews.map((preview, index) => (
              // 送信済みの縮小画像をそのまま出すだけなので next/image は使わない
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={preview.slice(-24)}
                src={preview}
                alt={`送信した画像 ${index + 1}`}
                className="h-24 w-24 rounded-lg border border-line object-cover"
              />
            ))}
          </div>
        )}
        {!message.imagePreviews && message.attachmentCount ? (
          <p className="mb-1 text-[12px] opacity-70">📷 スクリーンショット{message.attachmentCount}枚を送信</p>
        ) : null}
        {isUser ? message.text : <RichText text={message.text} gear={gear} />}
        {pending && <span className="ml-0.5 inline-block animate-blink text-accent">●</span>}
      </div>
    </div>
  );
}
