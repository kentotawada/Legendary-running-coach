'use client';

import { useEffect, useRef, useState } from 'react';
import { useCoachChat } from '@/hooks/useCoachChat';
import MessageItem from './MessageItem';
import type { Feedback } from './MessageActions';
import Composer, { type ComposerApi } from './Composer';
import ProfileSheet from './ProfileSheet';
import CoachProfileSheet from './CoachProfileSheet';
import IdeaSheet from './IdeaSheet';
import DailyStrip from './DailyStrip';
import DailySheet from './DailySheet';
import ReviewSheet from './ReviewSheet';
import StravaGuide from './StravaGuide';
import AuthSheet from './AuthSheet';
import CoachAvatar from './CoachAvatar';
import ImageLightbox from './ImageLightbox';
import { findCharacter } from '@/lib/characters';
import { useReadAloud } from '@/hooks/useSpeech';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
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
    resend,
    canResend,
    regenerate,
    editLast,
    reset,
    reportError,
    updateProfile,
    savingProfile,
    daily,
    saveWeight,
    savingWeight,
    gear,
    auth,
    syncStrava,
    disconnectStrava,
    syncing,
    syncMessage,
    clearSyncMessage,
    needsDeviceGuide,
  } = useCoachChat();
  const composerRef = useRef<ComposerApi | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [coachSheetOpen, setCoachSheetOpen] = useState(false);
  const [ideasOpen, setIdeasOpen] = useState(false);
  const [dailyOpen, setDailyOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [celebration, setCelebration] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const [fontSize, setFontSize] = useState<FontSizeId>('medium');
  /** 返答への評価。端末を閉じるまでの記録で、コーチ側には送らない。 */
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const readAloud = useReadAloud();
  // キーボードで画面がずれて端が切れるのを防ぐ。
  useKeyboardInset();
  const bottomRef = useRef<HTMLDivElement>(null);
  const historyLength = useRef(0);

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

  /**
   * Strava から戻ってきた直後。
   * 結果をひとこと出して、URL のクエリは消す。
   * 残しておくと、再読み込みのたびに同じ知らせが出る。
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('strava');
    if (!result) return;

    const message: Record<string, string> = {
      connected: 'Stravaとつながりました。これまでの練習を取り込んでいます…',
      denied: 'Stravaとの連携は許可されませんでした。',
      state: '連携の手続きが途中で切れました。もう一度お試しください。',
      failed: 'Stravaとの連携に失敗しました。時間をおいて、もう一度お試しください。',
      unconfigured: 'このアプリでは Strava 連携が設定されていません。',
    };
    setCelebration(message[result] ?? null);
    window.history.replaceState({}, '', window.location.pathname);
    if (result === 'connected') void syncStrava();
  }, [syncStrava]);

  useEffect(() => {
    if (!celebration) return;
    const timer = setTimeout(() => setCelebration(null), 6000);
    return () => clearTimeout(timer);
  }, [celebration]);

  const activePains = profile?.pains.filter((p) => p.status !== 'resolved' && p.severity >= 1) ?? [];
  const coach = findCharacter(profile?.characterId);
  const lastCoachId = [...messages].reverse().find((m) => m.role === 'coach')?.id;
  // 書き直せるのは直前の発言だけ。それより前を書き換えると、後の会話と噛み合わなくなる。
  const lastUserId = [...messages].reverse().find((m) => m.role === 'user')?.id;

  return (
    <div className="app-shell flex flex-col overflow-hidden bg-bg text-fg">
      <header className="safe-top z-10 flex items-center gap-3 border-b border-line bg-bg px-4 pb-3">
        <button
          type="button"
          onClick={() => setCoachSheetOpen(true)}
          aria-label={`${coach.name} のプロフィールを開く`}
          className="shrink-0 transition active:scale-95"
        >
          <CoachAvatar character={coach} size={36} />
        </button>
        <button
          type="button"
          onClick={() => setCoachSheetOpen(true)}
          className="min-w-0 flex-1 text-left"
        >
          <h1 className="truncate text-[16px] font-bold tracking-tight">{coach.name}</h1>
        </button>
        <button
          type="button"
          onClick={() => setReviewOpen(true)}
          className="shrink-0 rounded-full border border-line px-3 py-2 text-[12px] font-medium"
        >
          ふりかえり
        </button>
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

      <main className="scroll-area flex-1 space-y-6 overflow-y-auto px-4 py-5">
        {!ready && <p className="pt-10 text-center text-[13px] text-muted">コーチを呼んでいます…</p>}

        {messages.map((message) => (
          <MessageItem
            key={message.id}
            message={message}
            coach={coach}
            gear={gear}
            busy={busy}
            canSpeak={readAloud.supported}
            speaking={readAloud.speakingId === message.id}
            onToggleSpeak={() => readAloud.toggle(message.id, message.text)}
            feedback={feedback[message.id] ?? null}
            onFeedback={(value) => setFeedback((prev) => ({ ...prev, [message.id]: value }))}
            onRegenerate={message.id === lastCoachId ? () => void regenerate() : undefined}
            canEdit={message.id === lastUserId && !busy}
            onEdit={(text) => void editLast(text, message.imagePreviews ?? [])}
            onReuseImages={(previews) => composerRef.current?.attachAgain(previews)}
            onOpenImage={(index) => setLightbox({ images: message.imagePreviews ?? [], index })}
            failed={Boolean(error) && canResend && message === messages[messages.length - 1]}
          />
        ))}

        {streamingText !== null && (
          <MessageItem
            message={{ id: 'streaming', role: 'coach', text: streamingText }}
            coach={coach}
            gear={gear}
            pending
          />
        )}

        {busy && streamingText === null && (
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <CoachAvatar character={coach} size={24} />
            <span className="animate-blink">考えています…</span>
          </div>
        )}

        {error && (
          <div className="rounded-[var(--radius)] border border-[color:var(--warn)] bg-warn-soft px-4 py-3.5 text-[13px] leading-relaxed text-warn">
            <p>{error}</p>
            {canResend && (
              <button
                type="button"
                onClick={() => void resend()}
                disabled={busy}
                className="mt-2.5 rounded-full bg-[color:var(--warn)] px-4 py-2 text-[13px] font-semibold text-[var(--accent-fg)] disabled:opacity-40"
              >
                同じ内容をもう一度送る
              </button>
            )}
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
          {celebration}
        </div>
      )}

      {!sheetOpen && syncMessage && (
        <button
          type="button"
          onClick={() => (needsDeviceGuide ? setGuideOpen(true) : clearSyncMessage())}
          className={`mx-4 mb-2 animate-rise rounded-[var(--radius)] border px-4 py-2.5 text-left text-[13px] leading-relaxed ${
            needsDeviceGuide
              ? 'border-[color:var(--accent)] bg-accent-soft text-accent'
              : 'border-line bg-sunken text-muted'
          }`}
        >
          {syncMessage}
          {needsDeviceGuide && <span className="mt-0.5 block font-semibold">つなぎ方の手順を見る →</span>}
        </button>
      )}

      <footer className="safe-bottom border-t border-line bg-bg">
        <Composer
          onSend={(text, images) => void send(text, images)}
          onError={reportError}
          onOpenIdeas={() => setIdeasOpen(true)}
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

      {coachSheetOpen && (
        <CoachProfileSheet
          currentId={profile?.characterId}
          saving={savingProfile}
          onSelect={(characterId) => {
            void updateProfile({ characterId });
            setCoachSheetOpen(false);
          }}
          onClose={() => setCoachSheetOpen(false)}
        />
      )}

      {reviewOpen && <ReviewSheet profile={profile} onClose={() => setReviewOpen(false)} />}

      {guideOpen && (
        <StravaGuide
          empty={needsDeviceGuide}
          onClose={() => {
            setGuideOpen(false);
            clearSyncMessage();
          }}
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
          stravaAvailable={build?.stravaAvailable}
          pushAvailable={build?.pushAvailable}
          syncing={syncing}
          syncMessage={syncMessage}
          onSyncStrava={() => void syncStrava()}
          onDisconnectStrava={() => void disconnectStrava()}
          onOpenDeviceGuide={() => {
            setSheetOpen(false);
            setGuideOpen(true);
          }}
          onSave={(edit) => void updateProfile(edit)}
          onClose={() => setSheetOpen(false)}
          onReset={() => void reset()}
        />
      )}
    </div>
  );
}
