'use client';

import { useLayoutEffect, useRef, useState } from 'react';

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
}

const MAX_HEIGHT = 140;

export default function Composer({ onSend, disabled = false }: Props) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  // 入力量に合わせて高さを伸ばす。上限を超えたら中でスクロールさせる。
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    setValue('');
    onSend(text);
  };

  return (
    <div className="flex items-end gap-2 px-4 pb-2">
      <textarea
        ref={ref}
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
        placeholder="今日の調子を聞かせてください"
        aria-label="コーチへのメッセージ"
        className="scroll-area max-h-[140px] min-h-[46px] flex-1 resize-none rounded-[var(--radius)] border border-line bg-elevated px-4 py-3 leading-relaxed text-fg outline-none placeholder:text-muted focus:border-[color:var(--accent)] disabled:opacity-60"
      />
      <button
        type="button"
        onClick={submit}
        disabled={disabled || !value.trim()}
        aria-label="送信"
        className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full bg-accent text-[var(--accent-fg)] transition active:scale-95 disabled:opacity-35"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 19V5" />
          <path d="m5 12 7-7 7 7" />
        </svg>
      </button>
    </div>
  );
}
