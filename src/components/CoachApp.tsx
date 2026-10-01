'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useCoachChat } from '@/hooks/useCoachChat';
import MessageItem from './MessageItem';
import type { Feedback } from './MessageActions';
import Composer, { type ComposerApi } from './Composer';
import ProfileSheet from './ProfileSheet';
import CoachProfileSheet from './CoachProfileSheet';
import IdeaSheet from './IdeaSheet';
import DailyStrip from './DailyStrip';
import DailySheet from './DailySheet';
import FormCoachSheet from './FormCoachSheet';
import RunFormSheet from './RunFormSheet';
import ReviewSheet from './ReviewSheet';
import CalendarSheet from './CalendarSheet';
import ConnectSheet from './ConnectSheet';
import ConnectBanner from './ConnectBanner';
import KeepRecordsBanner from './KeepRecordsBanner';
import RunSheet from './RunSheet';
import AuthSheet from './AuthSheet';
import CoachAvatar from './CoachAvatar';
import Welcome from './Welcome';
import ImageLightbox from './ImageLightbox';
import { findCharacter } from '@/lib/characters';
import { totals } from '@/lib/review';
import { useReadAloud } from '@/hooks/useSpeech';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
import { applyFontSize, loadFontSize, saveFontSize, type FontSizeId } from '@/lib/display';
import type { ActivityLog, ChatMessage } from '@/lib/types';
import { hasConsent } from '@/lib/legal';
import { sendFeedback } from '@/lib/feedback-client';
import ConsentGate from './ConsentGate';

/** 挨拶の吹き出しにだけ付ける id。保存された会話には無い。 */
const GREETING_ID = 'greeting';

export default function CoachApp() {
  const {
    messages,
    greeting,
    greetingAt,
    needsCoach,
    chooseCoach,
    giveConsent,
    saveNotifyHour,
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
    addIntake,
    savingWeight,
    gear,
    auth,
    syncStrava,
    importFiles,
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
  const [formOpen, setFormOpen] = useState(false);
  const [runFormOpen, setRunFormOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  /** 中身を開いている練習。区間と心拍の推移を見せる。 */
  const [openRun, setOpenRun] = useState<ActivityLog | null>(null);
  /**
   * どこから開いた画面か。
   * **閉じると全部消えるのは、開いた道を覚えていないのと同じ。**
   * カルテから開いた画面を閉じたら、カルテに戻す。
   */
  const [cameFromCarte, setCameFromCarte] = useState(false);

  /** 子の画面を閉じる。カルテから来ていれば、カルテに戻る。 */
  const closeChild = (close: () => void) => {
    close();
    if (cameFromCarte) {
      setCameFromCarte(false);
      setSheetOpen(true);
    }
  };
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

  /**
   * これまでの積み上げ。**ふりかえりは、このアプリでいちばん効く画面なのに、
   * 隅の小さなボタンの向こうに隠れていた。** 数字を表に出して、毎日見えるようにする。
   * 場所は増やさない。もともと在ったボタンが、数字を持つだけ。
   */
  const built = useMemo(() => (profile ? totals(profile) : null), [profile]);

  const activePains = profile?.pains.filter((p) => p.status !== 'resolved' && p.severity >= 1) ?? [];
  const coach = findCharacter(profile?.characterId);
  const lastCoachId = [...messages].reverse().find((m) => m.role === 'coach')?.id;

  /**
   * 画面に並べるもの。挨拶を、開いた時点の位置に差し込む。
   * 挨拶は保存された会話ではないので、ここでだけ混ぜる。
   */
  const shown = useMemo(() => {
    if (!ready || !greeting) return messages;
    const at = greetingAt ?? messages.length;
    const line: ChatMessage = { id: GREETING_ID, role: 'coach', text: greeting };
    return [...messages.slice(0, at), line, ...messages.slice(at)];
  }, [ready, greeting, greetingAt, messages]);
  // 書き直せるのは直前の発言だけ。それより前を書き換えると、後の会話と噛み合わなくなる。
  const lastUserId = [...messages].reverse().find((m) => m.role === 'user')?.id;

  /**
   * まだ誰にも見てもらっていない人には、コーチ選びから。
   * **空のチャットに放り出さない。** 白紙の入力欄の前で止まった人は、たいてい戻ってこない。
   */
  if (ready && needsCoach) {
    return <Welcome onPick={(id, name) => void chooseCoach(id, name)} busy={busy || savingProfile} />;
  }

  /**
   * 規約ができる前から使っている人と、規約の版が上がってから開いた人。
   * **同意するまで、体の情報を預かる画面には進めない**（サーバー側でも断っている）。
   */
  if (ready && profile && !hasConsent(profile)) {
    return (
      <ConsentGate
        busy={busy || savingProfile}
        onAgree={() => void giveConsent()}
        onErase={() => void reset()}
      />
    );
  }

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
          aria-label="ふりかえりを開く"
          className="flex h-[38px] shrink-0 flex-col items-center justify-center rounded-full border border-line px-3"
        >
          {built && built.km > 0 ? (
            <>
              <span className="text-[13px] font-bold leading-none tabular-nums">
                {built.km.toLocaleString()}
                <span className="ml-0.5 text-[9px] font-medium text-muted">km</span>
              </span>
              <span className="mt-[3px] text-[9px] leading-none text-muted">ふりかえり</span>
            </>
          ) : (
            <span className="text-[12px] font-medium leading-none">ふりかえり</span>
          )}
        </button>
        {/*
          カレンダー。**字ではなく絵で置く。**
          頭の列は幅が限られていて、3つ目に字を足すとコーチの名前が潰れる。
          月の枡は、形そのものが何の画面かを言っている。
        */}
        <button
          type="button"
          onClick={() => setCalendarOpen(true)}
          aria-label="カレンダーを開く"
          className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border border-line"
        >
          <svg viewBox="0 0 24 24" className="h-[17px] w-[17px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="5" width="18" height="16" rx="3" />
            <path d="M3 10h18M8 3v4M16 3v4" />
            <circle cx="8.5" cy="14.5" r="1.1" fill="currentColor" stroke="none" />
            <circle cx="12" cy="14.5" r="1.1" fill="currentColor" stroke="none" />
            <circle cx="15.5" cy="18" r="1.1" fill="currentColor" stroke="none" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="flex h-[38px] shrink-0 items-center rounded-full border border-line px-3.5 text-[12px] font-medium"
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

      {/*
        未ログインで記録が積み上がっている人に、消える経路があることを知らせる。
        **失って困るものが出来てから出す。** 初日に出すと、ただの登録の壁になる。
      */}
      {ready && build?.authAvailable && !auth.isAuthenticated && (
        <KeepRecordsBanner
          activityCount={profile?.activities.length ?? 0}
          onOpen={() => setAuthOpen(true)}
        />
      )}

      {/* つながっていない人にだけ、入口が在ることを知らせる。閉じれば二度と出ない。 */}
      {ready && build?.stravaAvailable && !profile?.connections?.strava && (
        <ConnectBanner onOpen={() => setConnectOpen(true)} />
      )}

      <main className="scroll-area flex-1 space-y-6 overflow-y-auto px-4 py-5">
        {!ready && <p className="pt-10 text-center text-[13px] text-muted">コーチを呼んでいます…</p>}

        {/*
          コーチのほうから言う一言を、**開いた時点の位置**に差し込む。
          末尾に固定で描くと、送った発言への返事の後ろに出てしまう。
        */}
        {shown.map((message) => {
          // 挨拶には操作の並びを付けない。作り直しも評価も要らない、ただの挨拶。
          if (message.id === GREETING_ID) {
            return <MessageItem key={message.id} message={message} coach={coach} />;
          }
          return (
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
              onFeedback={(value, reason) => {
                setFeedback((prev) => ({ ...prev, [message.id]: value }));
                // 取り消し（押し直して外す）は送らない。残っている評価はそのまま読む。
                if (value) sendFeedback({ rating: value, reason, reply: message.text });
              }}
              onRegenerate={message.id === lastCoachId ? () => void regenerate() : undefined}
              canEdit={message.id === lastUserId && !busy}
              onEdit={(text) => void editLast(text, message.imagePreviews ?? [])}
              onReuseImages={(previews) => composerRef.current?.attachAgain(previews)}
              onOpenImage={(index) => setLightbox({ images: message.imagePreviews ?? [], index })}
              failed={Boolean(error) && canResend && message === messages[messages.length - 1]}
            />
          );
        })}

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
          onClick={() => (needsDeviceGuide ? setConnectOpen(true) : clearSyncMessage())}
          className={`mx-4 mb-2 animate-rise rounded-[var(--radius)] border px-4 py-2.5 text-left text-[13px] leading-relaxed ${
            needsDeviceGuide
              ? 'border-[color:var(--accent)] bg-accent-soft text-accent'
              : 'border-line bg-sunken text-muted'
          }`}
        >
          <span className="block whitespace-pre-line">{syncMessage}</span>
          {needsDeviceGuide && <span className="mt-0.5 block font-semibold">つなぎ方を見る →</span>}
        </button>
      )}

      <footer className="safe-bottom border-t border-line bg-bg">
        <Composer
          onSend={(text, images) => void send(text, images)}
          onError={reportError}
          onOpenIdeas={() => setIdeasOpen(true)}
          onImportFiles={(files) => void importFiles(files)}
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

      {calendarOpen && (
        <CalendarSheet
          profile={profile}
          onClose={() => closeChild(() => setCalendarOpen(false))}
          onBack={cameFromCarte ? () => closeChild(() => setCalendarOpen(false)) : undefined}
          backLabel={cameFromCarte ? 'カルテ' : undefined}
        />
      )}

      {reviewOpen && (
        <ReviewSheet
          profile={profile}
          onImport={() => {
            setReviewOpen(false);
            setConnectOpen(true);
          }}
          onOpenCalendar={() => {
            setReviewOpen(false);
            setCalendarOpen(true);
          }}
          onClose={() => setReviewOpen(false)}
        />
      )}

      {openRun && (
        <RunSheet
          activity={openRun}
          profile={profile}
          onClose={() => setOpenRun(null)}
          onBack={cameFromCarte ? () => closeChild(() => setOpenRun(null)) : undefined}
        />
      )}

      {connectOpen && (
        <ConnectSheet
          connection={profile?.connections?.strava}
          available={Boolean(build?.stravaAvailable)}
          empty={needsDeviceGuide}
          syncing={syncing}
          syncMessage={syncMessage}
          onSync={() => void syncStrava()}
          onImportFiles={(files) => void importFiles(files)}
          onDisconnect={() => void disconnectStrava()}
          onClose={() => {
            setConnectOpen(false);
            clearSyncMessage();
          }}
          onBack={
            cameFromCarte
              ? () =>
                  closeChild(() => {
                    setConnectOpen(false);
                    clearSyncMessage();
                  })
              : undefined
          }
        />
      )}

      {dailyOpen && daily && (
        <DailySheet
          daily={daily}
          saving={savingWeight}
          onSaveWeight={(kg, fat) => void saveWeight(kg, fat)}
          onAddIntake={(kcal) => void addIntake(kcal)}
          onSendImages={() => {
            setDailyOpen(false);
            composerRef.current?.openPicker();
          }}
          onSendFiles={() => {
            setDailyOpen(false);
            composerRef.current?.openRecordPicker();
          }}
          onOpenRunForm={() => {
            setDailyOpen(false);
            setRunFormOpen(true);
          }}
          onOpenForm={() => {
            setDailyOpen(false);
            setFormOpen(true);
          }}
          onClose={() => setDailyOpen(false)}
        />
      )}

      {formOpen && <FormCoachSheet onClose={() => setFormOpen(false)} />}

      {runFormOpen && (
        <RunFormSheet
          onSend={(text) => void send(text)}
          onClose={() => setRunFormOpen(false)}
        />
      )}

      {authOpen && (
        <AuthSheet
          auth={auth}
          onClose={() => setAuthOpen(false)}
          onBack={cameFromCarte ? () => closeChild(() => setAuthOpen(false)) : undefined}
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
            setCameFromCarte(true);
            setAuthOpen(true);
          }}
          fontSize={fontSize}
          onChangeFontSize={changeFontSize}
          stravaAvailable={build?.stravaAvailable}
          pushAvailable={build?.pushAvailable}
          onChangeNotifyHour={(hour) => void saveNotifyHour(hour)}
          onOpenConnect={() => {
            setSheetOpen(false);
            setCameFromCarte(true);
            setConnectOpen(true);
          }}
          onOpenRun={(activity) => {
            setSheetOpen(false);
            setCameFromCarte(true);
            setOpenRun(activity);
          }}
          onSave={(edit) => void updateProfile(edit)}
          onClose={() => setSheetOpen(false)}
          onReset={() => void reset()}
        />
      )}
    </div>
  );
}
