'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { speechRecognitionAvailable, speechSynthesisAvailable, toSpokenText } from '@/lib/speech';

/**
 * 音声まわりのブラウザ API は標準化が追いついておらず、
 * TypeScript の既定の型にも入っていない。使う分だけをここで宣言する。
 */
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as SpeechRecognitionCtor | null;
}

/**
 * 読み上げ。
 * 「いま喋っている発言」をひとつだけ持つことで、
 * 別の発言を押した時に前の読み上げが裏で鳴り続けるのを防ぐ。
 */
export function useReadAloud() {
  const [supported, setSupported] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  useEffect(() => {
    setSupported(speechSynthesisAvailable());
  }, []);

  const stop = useCallback(() => {
    if (!speechSynthesisAvailable()) return;
    window.speechSynthesis.cancel();
    setSpeakingId(null);
  }, []);

  // 画面を離れる時に鳴りっぱなしにしない。
  useEffect(() => () => {
    if (speechSynthesisAvailable()) window.speechSynthesis.cancel();
  }, []);

  const toggle = useCallback(
    (id: string, text: string) => {
      if (!speechSynthesisAvailable()) return;
      if (speakingId === id) {
        stop();
        return;
      }
      const spoken = toSpokenText(text);
      window.speechSynthesis.cancel();
      if (!spoken) return;

      const utterance = new SpeechSynthesisUtterance(spoken);
      utterance.lang = 'ja-JP';
      utterance.rate = 1;
      utterance.onend = () => setSpeakingId((current) => (current === id ? null : current));
      utterance.onerror = () => setSpeakingId((current) => (current === id ? null : current));
      setSpeakingId(id);
      window.speechSynthesis.speak(utterance);
    },
    [speakingId, stop],
  );

  return { supported, speakingId, toggle, stop };
}

export interface VoiceInput {
  supported: boolean;
  listening: boolean;
  /** マイクが使えない・許可されない時の説明。 */
  error: string | null;
  start: () => void;
  stop: () => void;
}

/**
 * 音声入力。
 * 認識した文字は送信せず入力欄に置く。読み違いをそのまま送ってしまうと、
 * コーチが誤った前提で助言することになる。必ず本人が見てから送る。
 */
export function useVoiceInput(onText: (text: string) => void): VoiceInput {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const handlerRef = useRef(onText);
  handlerRef.current = onText;

  useEffect(() => {
    setSupported(speechRecognitionAvailable());
  }, []);

  useEffect(() => () => recognitionRef.current?.abort(), []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    if (recognitionRef.current) recognitionRef.current.abort();

    setError(null);
    const recognition = new Ctor();
    recognition.lang = 'ja-JP';
    recognition.continuous = true;
    // 喋っている途中から文字が出た方が、認識されているか分かって安心できる。
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let text = '';
      for (let i = 0; i < event.results.length; i += 1) {
        text += event.results[i][0].transcript;
      }
      handlerRef.current(text);
    };
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setError('マイクの使用が許可されていません。ブラウザの設定から許可してください。');
      } else if (event.error === 'no-speech') {
        setError('声を拾えませんでした。もう一度試してください。');
      } else if (event.error !== 'aborted') {
        setError('音声を認識できませんでした。');
      }
      setListening(false);
    };
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setError('マイクを開始できませんでした。');
      setListening(false);
    }
  }, []);

  return { supported, listening, error, start, stop };
}
