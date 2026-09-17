'use client';

import { useEffect, useRef, useState } from 'react';
import { useCoachChat } from '@/hooks/useCoachChat';
import MessageBubble from './MessageBubble';
import Composer, { type ComposerApi } from './Composer';
import QuickCheckIn from './QuickCheckIn';
import ProfileSheet from './ProfileSheet';
import PhaseBadge from './PhaseBadge';

export default function CoachApp() {
  const { messages, streamingText, profile, busy, ready, error, errorDetail, build, send, reset, reportError } =
    useCoachChat();
  const composerRef = useRef<ComposerApi | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [celebration, setCelebration] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const historyLength = useRef(0);

  // 新しい発言が来たら常に最新へ。ストリーミング中も追従させる。
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streamingText]);

  // 目的が変わった瞬間は、アプリとしても一緒に喜ぶ。
  useEffect(() => {
    const history = profile?.phaseHistory ?? [];
    if (history.length > historyLength.current) {
      const latest = history[history.length - 1];
      if (historyLength.current > 0 && latest.to === 'goal') {
        setCelebration('目標が決まりましたね。ここからは一緒に、そこへ向かって積み上げていきましょう。');
      }
      historyLength.current = history.length;
    }
  }, [profile]);

  useEffect(() => {
    if (!celebration) return;
    const timer = setTimeout(() => setCelebration(null), 6000);
    return () => clearTimeout(timer);
  }, [celebration]);

  const activePains = profile?.pains.filter((p) => p.status !== 'resolved' && p.severity >= 1) ?? [];

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-bg text-fg">
      <header className="safe-top z-10 flex items-center gap-3 border-b border-line bg-elevated px-4 pb-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-lg" aria-hidden="true">
          🏃
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-bold leading-tight">伝説のパーソナルコーチ</h1>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
            {profile && <PhaseBadge phase={profile.phase} />}
            <p className="truncate text-[12px] text-muted">今日のあなたに合わせて</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="shrink-0 rounded-full border border-line px-3 py-2 text-[12px] font-medium"
        >
          カルテ
        </button>
      </header>

      {activePains.length > 0 && (
        <div className="border-b border-line bg-warn-soft px-4 py-2.5 text-[13px] leading-relaxed text-warn">
          <strong className="font-semibold">いまは走らない期間です。</strong>{' '}
          {activePains.map((p) => p.site).join('・')}が回復するまで、走る以外の方法で一緒に強くなりましょう。
        </div>
      )}

      <main className="scroll-area flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {!ready && <p className="pt-10 text-center text-[13px] text-muted">コーチを呼んでいます…</p>}

        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {streamingText !== null && (
          <MessageBubble message={{ id: 'streaming', role: 'coach', text: streamingText }} pending />
        )}

        {busy && streamingText === null && (
          <div className="flex justify-start">
            <div className="rounded-[var(--radius)] rounded-bl-md border border-line bg-[var(--coach-bubble)] px-4 py-3">
              <span className="animate-blink text-[13px] text-muted">考えています…</span>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-[var(--radius)] border border-[color:var(--warn)] bg-warn-soft px-4 py-3 text-[13px] leading-relaxed text-warn">
            <p>{error}</p>
            {errorDetail && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[12px] opacity-80">エラーの詳細を表示</summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-sunken px-3 py-2 text-[11px] leading-relaxed text-fg">
                  {errorDetail}
                </pre>
              </details>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      {celebration && (
        <div className="mx-4 mb-2 animate-rise rounded-[var(--radius)] border border-[color:var(--accent)] bg-accent-soft px-4 py-3 text-[13px] leading-relaxed text-accent">
          🎉 {celebration}
        </div>
      )}

      <footer className="safe-bottom border-t border-line bg-elevated">
        <QuickCheckIn
          onPick={(message) => void send(message)}
          onPickImage={() => composerRef.current?.openPicker()}
          disabled={busy || !ready}
        />
        <Composer
          onSend={(text, images) => void send(text, images)}
          onError={reportError}
          apiRef={composerRef}
          disabled={busy || !ready}
        />
      </footer>

      {sheetOpen && (
        <ProfileSheet
          profile={profile}
          build={build}
          onClose={() => setSheetOpen(false)}
          onReset={() => void reset()}
        />
      )}
    </div>
  );
}
