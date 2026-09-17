'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, RunnerProfile } from '@/lib/types';
import type { BuildInfo } from '@/lib/build-info';
import type { PreparedImage } from '@/lib/downscale';
import { DEFAULT_IMAGE_MESSAGE } from '@/lib/images';
import type { ProfileEdit } from '@/components/GoalEditor';

interface DoneEvent {
  type: 'done';
  profile: RunnerProfile;
  meta?: { usedTools: string[]; rewrites: number };
}
type StreamEvent =
  | { type: 'delta'; text: string }
  | DoneEvent
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
  reset: () => Promise<void>;
  /** カルテ画面からの設定変更。 */
  updateProfile: (edit: ProfileEdit) => Promise<void>;
  savingProfile: boolean;
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
  const counter = useRef(0);
  const started = useRef(false);

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
      } else {
        setError(event.message);
        setErrorDetail(event.detail ?? null);
      }
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
    async (text: string, images: PreparedImage[] = []) => {
      setBusy(true);
      setError(null);
      setErrorDetail(null);
      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            // preview は画面表示用。サーバーへは送らない。
            images: images.map(({ mimeType, data }) => ({ mimeType, data })),
          }),
        });
        if (!response.ok) {
          const detail = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(detail?.error ?? '通信に失敗しました。');
        }
        await consume(response);
      } catch (e) {
        setError(e instanceof Error ? e.message : '通信に失敗しました。');
        setErrorDetail(null);
        setStreamingText(null);
      } finally {
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

  // 初回ロード: これまでの会話を復元し、まだ何も無ければコーチから声をかける。
  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      try {
        const response = await fetch('/api/chat');
        const data = (await response.json()) as {
          messages: ChatMessage[];
          profile: RunnerProfile;
          hasApiKey: boolean;
          build?: BuildInfo;
        };
        setMessages(data.messages.map((m) => ({ ...m, id: `server-${m.id}` })));
        setProfile(data.profile);
        setBuild(data.build ?? null);
        setReady(true);
        if (!data.hasApiKey) {
          setError('GEMINI_API_KEY が設定されていません。.env.local に Gemini API キーを入れてください。');
          return;
        }
        if (data.build && !data.build.apiKeyLooksValid) {
          // 引用符や改行ごと貼り付けてしまう事故は、実際に呼ぶ前に気づけた方がいい。
          setError(
            'GEMINI_API_KEY の形が Google AI Studio のキー（AIza… で始まる文字列）と違います。' +
              '引用符や改行が混ざっていないか確認してください。',
          );
        }
        if (data.messages.length === 0) await turn('');
      } catch {
        setReady(true);
        setError('コーチに接続できませんでした。通信環境を確認して、もう一度開いてください。');
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

  const updateProfile = useCallback(async (edit: ProfileEdit) => {
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
    reset,
    reportError,
    updateProfile,
    savingProfile,
  };
}
