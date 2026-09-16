import type { ChatMessage } from '@/lib/types';

interface Props {
  message: ChatMessage;
  /** 生成中のカーソルを出すか。 */
  pending?: boolean;
}

export default function MessageBubble({ message, pending = false }: Props) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex w-full animate-rise ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={[
          'max-w-[85%] whitespace-pre-wrap break-words rounded-[var(--radius)] px-4 py-3 text-[15px] leading-[1.75]',
          isUser
            ? 'rounded-br-md bg-[var(--user-bubble)] text-[var(--user-bubble-fg)]'
            : 'rounded-bl-md border border-line bg-[var(--coach-bubble)] text-fg shadow-sm',
        ].join(' ')}
      >
        {message.text}
        {pending && <span className="ml-0.5 inline-block animate-blink text-accent">●</span>}
      </div>
    </div>
  );
}
