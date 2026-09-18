'use client';

import { useEffect, useRef, useState } from 'react';
import { useCoachChat } from '@/hooks/useCoachChat';
import MessageBubble from './MessageBubble';
import Composer, { type ComposerApi } from './Composer';
import QuickCheckIn from './QuickCheckIn';
import ProfileSheet from './ProfileSheet';
import IdeaSheet from './IdeaSheet';
import DailyStrip from './DailyStrip';
import DailySheet from './DailySheet';
import AuthSheet from './AuthSheet';
import PhaseBadge from './PhaseBadge';
import CoachAvatar from './CoachAvatar';
import ImageLightbox from './ImageLightbox';
import { findCharacter } from '@/lib/characters';
import { useReadAloud } from '@/hooks/useSpeech';
import { applyFontSize, loadFontSize, saveFontSize, type FontSizeId } from '@/lib/display';

export default function CoachApp() {
  const {
    messages,
    streamingText,
    profile,
    busy,
    ready,
    error,
    errorDetail,
    build,
    send,
    reset,
    reportError,
    updateProfile,
    savingProfile,
    daily,
    saveWeight,
    savingWeight,
    gear,
    auth,
  } = useCoachChat();
  const composerRef = useRef<ComposerApi | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [ideasOpen, setIdeasOpen] = useState(false);
  const [dailyOpen, setDailyOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [celebration, setCelebration] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const [fontSize, setFontSize] = useState<FontSizeId>('medium');
  const readAloud = useReadAloud();
  const bottomRef = useRef<HTMLDivElement>(null);
  const historyLength = useRef(0);

  // 文字サイズはこの端末の設定。描画前に当てた値を、画面の状態にも取り込む。
  useEffect(() => {
    setFontSize(loadFontSize());
  }, []);

  const changeFontSize = (id: FontSizeId) => {
    setFontSize(id);
    applyFontSize(id);
    saveFontSize(id);
  };

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
  const character = findCharacter(profile?.characterId);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-bg text-fg">
      <header className="safe-top z-10 flex items-center gap-3 border-b border-line bg-elevated px-4 pb-3">
        <CoachAvatar character={character} size={40} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-bold leading-tight">コーチ {character.name}</h1>
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

      {daily && <DailyStrip daily={daily} onOpen={() => setDailyOpen(true)} />}

      {activePains.length > 0 && (
        <div className="border-b border-line bg-warn-soft px-4 py-2.5 text-[13px] leading-relaxed text-warn">
          <strong className="font-semibold">いまは走らない期間です。</strong>{' '}
          {activePains.map((p) => p.site).join('・')}が回復するまで、走る以外の方法で一緒に強くなりましょう。
        </div>
      )}

      <main className="scroll-area flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {!ready && <p className="pt-10 text-center text-[13px] text-muted">コーチを呼んでいます…</p>}

        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            gear={gear}
            canSpeak={readAloud.supported}
            speaking={readAloud.speakingId === message.id}
            onToggleSpeak={() => readAloud.toggle(message.id, message.text)}
            onOpenImage={(index) =>
              setLightbox({ images: message.imagePreviews ?? [], index })
            }
          />
        ))}

        {streamingText !== null && (
          <MessageBubble
            message={{ id: 'streaming', role: 'coach', text: streamingText }}
            gear={gear}
            pending
          />
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
          onOpenIdeas={() => setIdeasOpen(true)}
          disabled={busy || !ready}
        />
        <Composer
          onSend={(text, images) => void send(text, images)}
          onError={reportError}
          apiRef={composerRef}
          disabled={busy || !ready}
        />
      </footer>

      {lightbox && lightbox.images.length > 0 && (
        <ImageLightbox
          images={lightbox.images}
          startIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}

      {dailyOpen && daily && (
        <DailySheet
          daily={daily}
          saving={savingWeight}
          onSaveWeight={(kg) => void saveWeight(kg)}
          onClose={() => setDailyOpen(false)}
        />
      )}

      {authOpen && (
        <AuthSheet
          auth={auth}
          onClose={() => setAuthOpen(false)}
          onSignedOut={() => window.location.reload()}
        />
      )}

      {ideasOpen && (
        <IdeaSheet
          onPick={(question) => {
            composerRef.current?.setText(question);
            setIdeasOpen(false);
          }}
          onClose={() => setIdeasOpen(false)}
        />
      )}

      {sheetOpen && (
        <ProfileSheet
          profile={profile}
          build={build}
          saving={savingProfile}
          signedInAs={auth.isAuthenticated ? (auth.email ?? 'ログイン済み') : undefined}
          authAvailable={auth.available}
          onOpenAuth={() => {
            setSheetOpen(false);
            setAuthOpen(true);
          }}
          fontSize={fontSize}
          onChangeFontSize={changeFontSize}
          onSave={(edit) => void updateProfile(edit)}
          onClose={() => setSheetOpen(false)}
          onReset={() => void reset()}
        />
      )}
    </div>
  );
}
