'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, RunnerProfile } from '@/lib/types';
import type { BuildInfo } from '@/lib/build-info';
import type { DailyStatus } from '@/lib/daily';
import type { ResolvedGear } from '@/lib/gear';
import type { AuthState } from '@/components/AuthSheet';
import type { PreparedImage } from '@/lib/downscale';
import { DEFAULT_IMAGE_MESSAGE } from '@/lib/images';
import {
  TURN_TIMEOUT_MS,
  describeHttpFailure,
  describeStreamFailure,
} from '@/lib/transport-error';
import type { ProfileEdit } from '@/components/GoalEditor';

interface DoneEvent {
  type: 'done';
  profile: RunnerProfile;
  meta?: { usedTools: string[]; rewrites: number };
}
type StreamEvent =
  | { type: 'delta'; text: string }
  | DoneEvent
  | { type: 'ping' }
  | { type: 'error'; message: string; detail?: string };

export interface CoachChat {
  messages: ChatMessage[];
  streamingText: string | null;
  profile: RunnerProfile | null;
  busy: boolean;
  ready: boolean;
  error: string | null;
  /** 原因の切り分けに使う、サーバー側が受け取った生のエラー文。 */
  errorDetail: string | null;
  /** どのビルドを見ているか。古いデプロイを見続けている事故を切り分けるため。 */
  build: BuildInfo | null;
  send: (text: string, images?: PreparedImage[]) => Promise<void>;
  /** 直前に失敗した送信を、書き直さずにもう一度送る。 */
  resend: () => Promise<void>;
  /** 送り直す価値のある失敗が残っているか。 */
  canResend: boolean;
  /** コーチの返答をもう一度作り直す。 */
  regenerate: () => Promise<void>;
  reset: () => Promise<void>;
  /** カルテ画面からの設定変更。変える項目だけを渡してよい。 */
  updateProfile: (edit: Partial<ProfileEdit>) => Promise<void>;
  savingProfile: boolean;
  /** 今日のスタンプと連続日数。 */
  daily: DailyStatus | null;
  /** 道具カードのカタログ。リンクはサーバーが組み立てたもの。 */
  gear: ResolvedGear[];
  /** ログイン状態。 */
  auth: AuthState;
  saveWeight: (weightKg: number) => Promise<void>;
  savingWeight: boolean;
  /** 画像の準備に失敗した時など、画面側から理由を差し込むため。 */
  reportError: (message: string) => void;
}

export function useCoachChat(): CoachChat {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [profile, setProfile] = useState<RunnerProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [build, setBuild] = useState<BuildInfo | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [daily, setDaily] = useState<DailyStatus | null>(null);
  const [gear, setGear] = useState<ResolvedGear[]>([]);
  const [auth, setAuth] = useState<AuthState>({ available: false, isAuthenticated: false });
  const [savingWeight, setSavingWeight] = useState(false);
  const [canResend, setCanResend] = useState(false);
  const counter = useRef(0);
  const started = useRef(false);
  /** 失敗した時に備えて、送った中身（画像を含む）をそのまま持っておく。 */
  const lastAttempt = useRef<{ text: string; images: PreparedImage[] } | null>(null);

  const nextId = () => `local-${(counter.current += 1)}`;

  /** NDJSON を1行ずつ読み、届いた端から画面に流す。 */
  const consume = useCallback(async (response: Response) => {
    if (!response.body) throw new Error('no body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';

    const handle = (event: StreamEvent) => {
      if (event.type === 'delta') {
        text += event.text;
        setStreamingText(text);
      } else if (event.type === 'done') {
        setProfile(event.profile);
      } else if (event.type === 'error') {
        setError(event.message);
        setErrorDetail(event.detail ?? null);
        // サーバーが理由を返してきた失敗も、送り直せば通ることがある。
        setCanResend(true);
      }
      // ping など、知らない種類の行は黙って読み飛ばす。
      // 「知らない＝エラー」にすると、後から行を足した時に画面が壊れる。
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          handle(JSON.parse(line) as StreamEvent);
        } catch {
          // 行が壊れていても対話は止めない。
        }
      }
    }
    if (buffer.trim()) {
      try {
        handle(JSON.parse(buffer) as StreamEvent);
      } catch {
        /* noop */
      }
    }

    setStreamingText(null);
    if (text.trim()) {
      setMessages((prev) => [...prev, { id: nextId(), role: 'coach', text: text.trim() }]);
    }
  }, []);

  const turn = useCallback(
    async (text: string, images: PreparedImage[] = [], mode: 'send' | 'regenerate' = 'send') => {
      setBusy(true);
      setError(null);
      setErrorDetail(null);
      setCanResend(false);
      if (mode === 'send') lastAttempt.current = { text, images };

      // 応答が返らないまま固まり続けないよう、こちらからも打ち切る。
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), TURN_TIMEOUT_MS);

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abort.signal,
          body: JSON.stringify({
            message: text,
            regenerate: mode === 'regenerate',
            // preview は画面表示用なので送らない。thumbnail は後から見返すために保存される。
            images: images.map(({ mimeType, data, thumbnail }) => ({ mimeType, data, thumbnail })),
          }),
        });

        if (!response.ok) {
          // ここに来るのは実行基盤が返した応答で、うちの JSON とは限らない。
          // 本文をそのまま読んで、状態番号ごと画面に残す。
          const body = await response.text().catch(() => '');
          const failure = describeHttpFailure(response.status, response.statusText, body);
          setError(failure.message);
          setErrorDetail(failure.detail);
          setCanResend(failure.retryable);
          setStreamingText(null);
          return;
        }

        await consume(response);
      } catch (e) {
        const failure = describeStreamFailure(e);
        setError(failure.message);
        setErrorDetail(failure.detail);
        setCanResend(failure.retryable);
        setStreamingText(null);
      } finally {
        clearTimeout(timer);
        setBusy(false);
      }
    },
    [consume],
  );

  const send = useCallback(
    async (text: string, images: PreparedImage[] = []) => {
      // 画像だけ送られた時も、何を頼んだのかが吹き出しに残るようにする。
      const trimmed = text.trim() || (images.length > 0 ? DEFAULT_IMAGE_MESSAGE : '');
      if ((!trimmed && images.length === 0) || busy) return;
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'user',
          text: trimmed,
          ...(images.length > 0 ? { imagePreviews: images.map((image) => image.preview) } : {}),
        },
      ]);
      await turn(trimmed, images);
    },
    [busy, turn],
  );

  /**
   * 失敗した送信をもう一度。
   * 長い練習報告を書き直させるのは、それだけで続ける気持ちを折る。
   * 画像も本文もそのまま持っているので、同じ中身をそのまま送り直す。
   */
  const resend = useCallback(async () => {
    const attempt = lastAttempt.current;
    if (!attempt || busy) return;
    await turn(attempt.text, attempt.images);
  }, [busy, turn]);

  /** 返答が的外れだった時に、同じ問いかけから作り直す。 */
  const regenerate = useCallback(async () => {
    if (busy) return;
    // 画面からも直前の返答を外す。作り直した方だけが残るようにする。
    setMessages((prev) => {
      const lastCoach = [...prev].reverse().find((m) => m.role === 'coach');
      return lastCoach ? prev.filter((m) => m.id !== lastCoach.id) : prev;
    });
    await turn('', [], 'regenerate');
  }, [busy, turn]);

  // 初回ロード: これまでの会話を復元し、まだ何も無ければコーチから声をかける。
  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      try {
        const response = await fetch('/api/chat');
        if (!response.ok) {
          // 保存層の設定ミスなど、サーバーが理由を返している場合はそれを見せる。
          const failure = (await response.json().catch(() => null)) as
            | { error?: string; hint?: string }
            | null;
          if (failure?.error) {
            setErrorDetail(failure.hint ?? null);
            throw new Error(failure.error);
          }
          throw new Error(`サーバーが応答しませんでした (${response.status})`);
        }

        const data = (await response.json()) as {
          messages: ChatMessage[];
          profile: RunnerProfile;
          hasApiKey: boolean;
          build?: BuildInfo;
          gear?: ResolvedGear[];
          auth?: AuthState;
        };
        setMessages(data.messages.map((m) => ({ ...m, id: `server-${m.id}` })));

        // 「今日ここを開いた」を記録する。スタンプはこれが起点。
        void fetch('/api/daily', { method: 'POST' })
          .then((r) => r.json())
          .then((d: { daily?: DailyStatus }) => d.daily && setDaily(d.daily))
          .catch(() => undefined);
        setProfile(data.profile);
        setBuild(data.build ?? null);
        setGear(data.gear ?? []);
        if (data.auth) setAuth(data.auth);
        setReady(true);
        if (!data.hasApiKey) {
          setError('GEMINI_API_KEY が設定されていません。.env.local に Gemini API キーを入れてください。');
          return;
        }
        // キーの形式だけを理由に警告は出さない。
        // 形式は提供側の都合で変わるため、動いているのに警告が出ると、
        // 本当の問題があるかのように見えてしまう。
        // 実際に無効なら、最初の対話で Gemini 側の理由が表示される。
        if (data.messages.length === 0) await turn('');
      } catch (e) {
        setReady(true);
        setError(
          e instanceof Error && e.message
            ? e.message
            : 'コーチに接続できませんでした。通信環境を確認して、もう一度開いてください。',
        );
      }
    })();
  }, [turn]);

  const reset = useCallback(async () => {
    await fetch('/api/profile', { method: 'DELETE' });
    setMessages([]);
    setProfile(null);
    setStreamingText(null);
    setError(null);
    setErrorDetail(null);
    await turn('');
  }, [turn]);

  const updateProfile = useCallback(async (edit: Partial<ProfileEdit>) => {
    setSavingProfile(true);
    setError(null);
    setErrorDetail(null);
    try {
      const response = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(edit),
      });
      const data = (await response.json()) as { profile?: RunnerProfile; error?: string };
      if (!response.ok || !data.profile) {
        throw new Error(data.error ?? '設定を保存できませんでした。');
      }
      setProfile(data.profile);
    } catch (e) {
      setError(e instanceof Error ? e.message : '設定を保存できませんでした。');
    } finally {
      setSavingProfile(false);
    }
  }, []);

  const saveWeight = useCallback(async (weightKg: number) => {
    setSavingWeight(true);
    try {
      const response = await fetch('/api/daily', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weightKg }),
      });
      const data = (await response.json()) as {
        daily?: DailyStatus;
        profile?: RunnerProfile;
        error?: string;
      };
      if (!response.ok || !data.daily) throw new Error(data.error ?? '体重を記録できませんでした。');
      setDaily(data.daily);
      if (data.profile) setProfile(data.profile);
    } catch (e) {
      setError(e instanceof Error ? e.message : '体重を記録できませんでした。');
    } finally {
      setSavingWeight(false);
    }
  }, []);

  const reportError = useCallback((message: string) => {
    setError(message);
    setErrorDetail(null);
  }, []);

  return {
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
    reset,
    reportError,
    updateProfile,
    savingProfile,
    daily,
    gear,
    auth,
    saveWeight,
    savingWeight,
  };
}
