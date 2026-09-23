'use client';

import { useEffect, useRef, useState } from 'react';
import { toSpokenText } from '@/lib/speech';

export type Feedback = 'good' | 'bad' | null;

interface Props {
  text: string;
  feedback: Feedback;
  onFeedback: (value: Feedback) => void;
  canSpeak: boolean;
  speaking: boolean;
  onToggleSpeak: () => void;
  onRegenerate: () => void;
  busy: boolean;
}

function Icon({ path, filled = false }: { path: React.ReactNode; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px]"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

const THUMB_UP = <path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm0 0 4.5-7a2 2 0 0 1 3.6 1.5L14 8h5a2 2 0 0 1 2 2.4l-1.6 8A2 2 0 0 1 17.4 20H7" />;
const THUMB_DOWN = <path d="M17 14V3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1zm0 0-4.5 7a2 2 0 0 1-3.6-1.5L10 16H5a2 2 0 0 1-2-2.4l1.6-8A2 2 0 0 1 6.6 4H17" />;

function ActionButton({
  label,
  onClick,
  active = false,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-9 w-9 items-center justify-center rounded-full transition active:scale-90 ${
        active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-sunken'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * コーチの返答に添える操作。
 * 読んで終わりにせず、手元に残す・人に見せる・作り直す、までを1タップで行けるようにする。
 */
export default function MessageActions({
  text,
  feedback,
  onFeedback,
  canSpeak,
  speaking,
  onToggleSpeak,
  onRegenerate,
  busy,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  // 画面のどこかを触ったらメニューを閉じる。開きっぱなしで邪魔をしない。
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent | TouchEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [menuOpen]);

  /** 画面に出ている形のまま渡す。記法の記号は読む人に必要ない。 */
  const plain = () => toSpokenText(text) || text;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plain());
      setCopied(true);
    } catch {
      // 権限が無い環境では黙って何もしない。エラーを出すほどのことではない。
    }
  };

  const share = async () => {
    const body = plain();
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ text: body });
        return;
      }
      await navigator.clipboard.writeText(body);
      setCopied(true);
    } catch {
      // 共有シートを閉じただけの場合もここに来る。何も言わない。
    }
  };

  return (
    <div ref={wrapper} className="relative mt-2 flex items-center gap-0.5">
      <ActionButton label={copied ? 'コピーしました' : 'コピー'} onClick={() => void copy()} active={copied}>
        {copied ? (
          <Icon path={<path d="m5 13 4 4L19 7" />} />
        ) : (
          <Icon
            path={
              <>
                <rect x="9" y="9" width="12" height="12" rx="2.5" />
                <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3h-7A2.5 2.5 0 0 0 3 5.5v7A2.5 2.5 0 0 0 5.5 15" />
              </>
            }
          />
        )}
      </ActionButton>

      {canShare && (
        <ActionButton label="共有" onClick={() => void share()}>
          <Icon
            path={
              <>
                <path d="M12 15V3" />
                <path d="m8 7 4-4 4 4" />
                <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
              </>
            }
          />
        </ActionButton>
      )}

      <ActionButton
        label="役に立った"
        active={feedback === 'good'}
        onClick={() => onFeedback(feedback === 'good' ? null : 'good')}
      >
        <Icon path={THUMB_UP} filled={feedback === 'good'} />
      </ActionButton>

      <ActionButton
        label="的外れだった"
        active={feedback === 'bad'}
        onClick={() => onFeedback(feedback === 'bad' ? null : 'bad')}
      >
        <Icon path={THUMB_DOWN} filled={feedback === 'bad'} />
      </ActionButton>

      <ActionButton label="その他の操作" onClick={() => setMenuOpen((open) => !open)} active={menuOpen}>
        <Icon
          path={
            <>
              <circle cx="5" cy="12" r="1.4" fill="currentColor" />
              <circle cx="12" cy="12" r="1.4" fill="currentColor" />
              <circle cx="19" cy="12" r="1.4" fill="currentColor" />
            </>
          }
        />
      </ActionButton>

      {copied && <span className="ml-1 text-[12px] text-muted">コピーしました</span>}

      {menuOpen && (
        <div className="absolute bottom-11 left-0 z-20 w-56 overflow-hidden rounded-[14px] border border-line bg-elevated py-1 shadow-[0_10px_30px_rgba(0,0,0,0.16)]">
          {canSpeak && (
            <button
              type="button"
              onClick={() => {
                onToggleSpeak();
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-[14px] active:bg-sunken"
            >
              <Icon path={<><path d="M11 5 6 9H3v6h3l5 4z" />{speaking ? <path d="M17 7v10" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7" />}</>} />
              {speaking ? '読み上げを止める' : '読み上げる'}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onRegenerate();
              setMenuOpen(false);
            }}
            className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-[14px] active:bg-sunken disabled:opacity-40"
          >
            <Icon path={<><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" /></>} />
            返答を作り直す
          </button>
        </div>
      )}
    </div>
  );
}
