'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, RunnerProfile } from '@/lib/types';

interface DoneEvent {
  type: 'done';
  profile: RunnerProfile;
  meta?: { usedTools: string[]; rewrites: number };
}
type StreamEvent = { type: 'delta'; text: string } | DoneEvent | { type: 'error'; message: string };

export interface CoachChat {
  messages: ChatMessage[];
  streamingText: string | null;
  profile: RunnerProfile | null;
  busy: boolean;
  ready: boolean;
  error: string | null;
  send: (text: string) => Promise<void>;
  reset: () => Promise<void>;
}

export function useCoachChat(): CoachChat {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [profile, setProfile] = useState<RunnerProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    async (text: string) => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text }),
        });
        if (!response.ok) {
          const detail = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(detail?.error ?? '通信に失敗しました。');
        }
        await consume(response);
      } catch (e) {
        setError(e instanceof Error ? e.message : '通信に失敗しました。');
        setStreamingText(null);
      } finally {
        setBusy(false);
      }
    },
    [consume],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      setMessages((prev) => [...prev, { id: nextId(), role: 'user', text: trimmed }]);
      await turn(trimmed);
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
        };
        setMessages(data.messages.map((m) => ({ ...m, id: `server-${m.id}` })));
        setProfile(data.profile);
        setReady(true);
        if (!data.hasApiKey) {
          setError('GEMINI_API_KEY が設定されていません。.env.local に Gemini API キーを入れてください。');
          return;
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
    await turn('');
  }, [turn]);

  return { messages, streamingText, profile, busy, ready, error, send, reset };
}
