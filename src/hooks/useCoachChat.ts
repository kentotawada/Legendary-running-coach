'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, RunnerProfile } from '@/lib/types';
import type { BuildInfo } from '@/lib/build-info';
import { dailyStatus, type DailyStatus } from '@/lib/daily';
import { coachDate } from '@/lib/day';
import { greetingFor } from '@/lib/greeting';

/** その日もう挨拶したか。端末ごとの控えなので、消えても実害は「もう一度言う」だけ。 */
const GREETED_KEY = 'rc_greeted_on';

/**
 * 今日まだ挨拶していなければ、控えを今日に進めて true を返す。
 * **読み書きできない端末がある。** そこで黙るより、毎回挨拶するほうがまし。
 */
function firstOpenToday(): boolean {
  const today = coachDate();
  try {
    if (localStorage.getItem(GREETED_KEY) === today) return false;
    localStorage.setItem(GREETED_KEY, today);
  } catch {
    // 読めない・書けない。挨拶はする。
  }
  return true;
}
import type { ResolvedGear } from '@/lib/gear';
import type { AuthState } from '@/components/AuthSheet';
import { dataUrlToFile, prepareImages, reattachName, type PreparedImage } from '@/lib/downscale';
import { DEFAULT_IMAGE_MESSAGE } from '@/lib/images';
import {
  TURN_TIMEOUT_MS,
  describeHttpFailure,
  describeStreamFailure,
} from '@/lib/transport-error';
import type { ProfileEdit } from '@/components/GoalEditor';
import { hasConsent } from '@/lib/legal';

/**
 * カルテへの書き込み。**同意は「同意した」という事実だけを送る。**
 * どの版に・いつ同意したかはサーバーが決める。
 */
type ProfileUpdate = Partial<ProfileEdit> & { consent?: true };
import { MAX_FILE_BYTES, parseWorkoutFile } from '@/lib/workout-file';
import {
  describeColumns,
  describeImport,
  prepareForTransport,
  type ImportedWorkout,
} from '@/lib/workout';
import { isWorkoutFile, isZipName, looksLikeZip, unzip } from '@/lib/zip';

/** 一度に送る練習の数。多すぎると受信の上限に当たる。 */
const IMPORT_BATCH = 100;

interface DoneEvent {
  type: 'done';
  profile: RunnerProfile;
  /** サーバー側で整え終えた最終の本文。流れてきた断片より、こちらが正しい。 */
  text?: string;
  meta?: { usedTools: string[]; rewrites: number };
}
type StreamEvent =
  | { type: 'delta'; text: string }
  | DoneEvent
  | { type: 'ping' }
  | { type: 'error'; message: string; detail?: string };

export interface CoachChat {
  messages: ChatMessage[];
  /** 開いた時にコーチのほうから言う一言。無い日は null。 */
  greeting: string | null;
  /** まだ誰に見てもらうかを選んでいない。**選ぶところから始める。** */
  needsCoach: boolean;
  /** コーチを決めて、会話を始める。 */
  chooseCoach: (characterId: string, displayName?: string) => Promise<void>;
  /** 通知を受け取る時刻を決める（0〜23、走る人の地域の時刻）。 */
  saveNotifyHour: (hour: number) => Promise<void>;
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
  /**
   * 直前に送った本文を書き直して送り直す。
   * 古いやり取りは履歴からも画面からも消える。
   */
  editLast: (text: string, previews: string[]) => Promise<void>;
  reset: () => Promise<void>;
  /** カルテ画面からの設定変更。変える項目だけを渡してよい。 */
  updateProfile: (edit: ProfileUpdate) => Promise<void>;
  /** 規約に同意する。まだ一度も話していなければ、そのままコーチが話し始める。 */
  giveConsent: () => Promise<void>;
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
  /** ランニングアプリから取り込む。画面を開いた時にも静かに走る。 */
  syncStrava: (quiet?: boolean) => Promise<void>;
  /** 時計から書き出したファイル（GPX / TCX）を取り込む。 */
  importFiles: (files: File[]) => Promise<void>;
  /** 連携を解除する。取り込んだ記録は消さない。 */
  disconnectStrava: () => Promise<void>;
  syncing: boolean;
  /** 取り込みの結果。読んだら消える一言。 */
  syncMessage: string | null;
  clearSyncMessage: () => void;
  /**
   * つないだのに1件も入らなかった時の合図。
   * 時計との連携がまだ、という場合がほとんどなので、手順へ誘導する。
   */
  needsDeviceGuide: boolean;
}

export function useCoachChat(): CoachChat {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  /**
   * 開いた時にコーチのほうから言う一言。
   * **保存しない。** 毎朝その日のデータから作り直すので、置いておく意味が無い。
   */
  const [greeting, setGreeting] = useState<string | null>(null);
  /**
   * まだ誰にも見てもらっていない人。
   * **いちばん最初にすることは、相手を決めること。**
   * 空のチャットに放り出すより、8人の顔を見せたほうが、次の一手が分かる。
   */
  const [needsCoach, setNeedsCoach] = useState(false);
  /**
   * その挨拶が、まだ会話に入っていないこと。
   * **入れずに返事だけ送ると、コーチは自分がした質問を知らないまま答えることになる。**
   */
  const greetingPending = useRef(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [profile, setProfile] = useState<RunnerProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [build, setBuild] = useState<BuildInfo | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  /**
   * 今日のスタンプ。
   *
   * **サーバーから受け取って持ち続けない。カルテから毎回組み立てる。**
   * スタンプの中身（走ったか・体重をはかったか）は、全部カルテに書いてある。
   * 別々に持つと、練習を取り込んでカルテが変わってもスタンプだけ古いままになる。
   * 実際それが起きていた: 今日の記録を入れても「体を動かす」が済みにならなかった。
   */
  const daily = useMemo<DailyStatus | null>(
    () => (profile ? dailyStatus(profile) : null),
    [profile],
  );
  const [gear, setGear] = useState<ResolvedGear[]>([]);
  const [auth, setAuth] = useState<AuthState>({ available: false, isAuthenticated: false });
  const [savingWeight, setSavingWeight] = useState(false);
  const [canResend, setCanResend] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [needsDeviceGuide, setNeedsDeviceGuide] = useState(false);
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
        // 差し替えが入る本文（商品カードなど）は、最後に届く完成版を採る。
        if (typeof event.text === 'string' && event.text.trim()) text = event.text;
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
    async (
      text: string,
      images: PreparedImage[] = [],
      mode: 'send' | 'regenerate' | 'replace' = 'send',
    ) => {
      setBusy(true);
      setError(null);
      setErrorDetail(null);
      setCanResend(false);
      if (mode !== 'regenerate') lastAttempt.current = { text, images };

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
            replaceLast: mode === 'replace',
            // preview は画面表示用なので送らない。thumbnail は後から見返すために保存される。
            images: images.map(({ mimeType, data, thumbnail }) => ({ mimeType, data, thumbnail })),
            /**
             * 画面でコーチが先に言った一言を、会話に入れてもらう。
             * **文章そのものは送らない。** 送ると、ブラウザ側から「コーチの発言」を
             * 好きに差し込めることになる。同じ計算をサーバー側でやり直してもらう。
             */
            greeted: greetingPending.current && mode === 'send',
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

        if (mode === 'send') greetingPending.current = false;
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

  /**
   * 書き直して送り直す。
   *
   * 画像は前回そのままを使う。同じセッション中なら送った時の画質のまま、
   * 読み込み直した後は保存してある見返し用の版から組み立て直す。
   */
  const editLast = useCallback(
    async (text: string, previews: string[]) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;

      const attempt = lastAttempt.current;
      const images =
        attempt && attempt.images.length === previews.length && attempt.images.length > 0
          ? attempt.images
          : (
              await prepareImages(
                previews
                  .map((preview, index) => dataUrlToFile(preview, reattachName(index, preview)))
                  .filter((file): file is File => file !== null),
              )
            ).images;

      setMessages((prev) => {
        // 直前のユーザー発言と、それに続く返答をまとめて外す。
        const lastUserIndex = prev.map((m) => m.role).lastIndexOf('user');
        if (lastUserIndex < 0) return prev;
        const original = prev[lastUserIndex];
        return [...prev.slice(0, lastUserIndex), { ...original, id: nextId(), text: trimmed }];
      });

      await turn(trimmed, images, 'replace');
    },
    [busy, turn],
  );

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

  /**
   * ランニングアプリから取り込む。
   *
   * quiet は画面を開いた時の自動実行。**新しい練習が無ければ何も言わない。**
   * 「新着0件」を毎回知らせるのは、ただの雑音になる。
   */
  const syncStrava = useCallback(async (quiet = false) => {
    setSyncing(true);
    try {
      const response = await fetch('/api/strava/sync', { method: 'POST' });
      const data = (await response.json().catch(() => null)) as
        | {
            profile?: RunnerProfile;
            message?: string;
            imported?: number;
            firstTime?: boolean;
            error?: string;
          }
        | null;

      if (!response.ok) {
        if (!quiet) setSyncMessage(data?.error ?? '取り込めませんでした。');
        return;
      }
      if (data?.profile) setProfile(data.profile);
      // 初回で1件も入らなかった時だけ、手順を出す合図を立てる。
      setNeedsDeviceGuide(Boolean(data?.firstTime) && (data?.imported ?? 0) === 0);
      if (!quiet || (data?.imported ?? 0) > 0) setSyncMessage(data?.message ?? null);
    } catch {
      if (!quiet) setSyncMessage('取り込めませんでした。通信の状態を確かめてください。');
    } finally {
      setSyncing(false);
    }
  }, []);

  /**
   * 書き出したファイルから取り込む。
   *
   * **読むのはここ（ブラウザ）で済ませる。** ロング走の GPX は数MBあり、
   * そのまま送ると受信の上限に当たる。サーバーへは数値だけを送る。
   *
   * zip もそのまま受ける。Garmin の「ファイルのエクスポート」は zip で降ってくるし、
   * アカウント全体の一括書き出しも zip。**開ければ、1回の操作で全期間が入る。**
   */
  const importFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setSyncing(true);
    setSyncMessage(null);

    const workouts: ImportedWorkout[] = [];
    /** 読めなかったものは、名前と理由をそのまま覚えておく。件数だけでは直しようがない。 */
    const failed: string[] = [];

    const read = (name: string, data: ArrayBuffer) => {
      try {
        const found = parseWorkoutFile(name, data);
        // 例外も投げず、1本も返さないファイルがある。**黙って消さない。**
        if (found.length === 0) {
          failed.push(`「${name}」の中に、練習が入っていませんでした。`);
          return;
        }
        workouts.push(...found);
      } catch (error) {
        failed.push(error instanceof Error ? error.message : `「${name}」を読めませんでした。`);
      }
    };

    const open = async (name: string, data: ArrayBuffer, depth = 0) => {
      // **名前ではなく中身で見分ける。** 端末が拡張子を落とすことがある。
      if (!looksLikeZip(data) && !isZipName(name)) {
        read(name, data);
        return;
      }

      try {
        setSyncMessage(`${name} を開いています…`);
        // 一括書き出しは、zip の中にさらに zip が入っていることがある。1段だけ開く。
        const entries = await unzip(data, (inner) =>
          depth === 0 ? isWorkoutFile(inner) || isZipName(inner) : isWorkoutFile(inner),
        );
        if (entries.length === 0) {
          failed.push(`「${name}」の中に、練習のファイル（FIT / TCX / GPX）が見つかりませんでした。`);
          return;
        }
        for (const entry of entries) await open(entry.name, entry.data, depth + 1);
      } catch (error) {
        failed.push(
          error instanceof Error ? `「${name}」: ${error.message}` : `「${name}」を開けませんでした。`,
        );
      }
    };

    try {
      for (const file of files) {
        if (file.size > MAX_FILE_BYTES) {
          failed.push(`「${file.name}」は大きすぎます。`);
          continue;
        }
        await open(file.name, await file.arrayBuffer());
      }

      // 1件も読めなかった時に「取り込みました」と言わない。**理由をそのまま出す。**
      if (workouts.length === 0) {
        const more = failed.length > 1 ? `（ほか${failed.length - 1}件）` : '';
        setSyncMessage(failed[0] ? `${failed[0]}${more}` : '練習が見つかりませんでした。');
        return;
      }

      const prepared = prepareForTransport(workouts);
      const total = { imported: 0, skipped: 0, upgraded: 0, dropped: 0 };
      let latest: RunnerProfile | undefined;

      // 数年ぶんを一度に送ると受信の上限に当たる。小分けにして順に送る。
      for (let from = 0; from < prepared.length; from += IMPORT_BATCH) {
        const batch = prepared.slice(from, from + IMPORT_BATCH);
        if (prepared.length > IMPORT_BATCH) {
          setSyncMessage(
            `取り込み中… ${Math.min(from + batch.length, prepared.length)} / ${prepared.length}件`,
          );
        }

        const response = await fetch('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workouts: batch }),
        });
        const data = (await response.json().catch(() => null)) as
          | {
              profile?: RunnerProfile;
              imported?: number;
              skipped?: number;
              upgraded?: number;
              dropped?: number;
              error?: string;
            }
          | null;

        if (!response.ok) {
          // 途中まで入った分は残る。全部やり直しにしない。
          setSyncMessage(data?.error ?? '取り込めませんでした。');
          if (latest) setProfile(latest);
          return;
        }
        total.imported += data?.imported ?? 0;
        total.skipped += data?.skipped ?? 0;
        total.upgraded += data?.upgraded ?? 0;
        total.dropped += data?.dropped ?? 0;
        if (data?.profile) latest = data.profile;
      }

      if (latest) setProfile(latest);
      // 読めなかったファイルがあったことは、隠さずに添える。理由も1つ出す。
      const note = failed.length > 0 ? `（${failed.length}件は読めませんでした: ${failed[0]}）` : '';
      // **ファイルに何が入っていたかを、その場で見せる。**
      // グラフが出ない時、原因がファイル側なのかアプリ側なのかが、これで分かる。
      setSyncMessage(`${describeImport(total)}${note}\n${describeColumns(workouts)}`);
    } catch {
      setSyncMessage('取り込めませんでした。通信の状態を確かめてください。');
    } finally {
      setSyncing(false);
    }
  }, []);

  const disconnectStrava = useCallback(async () => {
    setSyncing(true);
    try {
      const response = await fetch('/api/strava/disconnect', { method: 'POST' });
      const data = (await response.json().catch(() => null)) as { profile?: RunnerProfile } | null;
      if (data?.profile) setProfile(data.profile);
      setSyncMessage('連携を解除しました。取り込んだ記録はそのまま残っています。');
    } catch {
      setSyncMessage('解除できませんでした。');
    } finally {
      setSyncing(false);
    }
  }, []);

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
          .then((d: { profile?: RunnerProfile }) => d.profile && setProfile(d.profile))
          .catch(() => undefined);
        setProfile(data.profile);
        // つないであるなら、開いた時点でもう取り込んでおく。
        // 走り終えて開いた時に、記録がすでに入っている状態をつくるため。
        if (data.profile?.connections?.strava) void syncStrava(true);
        setBuild(data.build ?? null);
        setGear(data.gear ?? []);
        if (data.auth) setAuth(data.auth);
        setReady(true);

        /**
         * こちらから先に一言。**ここが無いと、開いた画面は白紙のまま。**
         *
         * まだ一度も話していない人には、コーチ自身に書かせる（下の turn('')）。
         * それ以外は、カルテから組み立てた一言を出す。
         * **こちらはモデルを呼ばない。** 向こうが落ちている日でも、コーチは黙らない。
         * まだ話していない人でも、モデルを呼べない時はこちらを出す。
         *
         * 1日の最初の一度だけ。開くたびに繰り返すと、ただの飾りになる。
         */
        /**
         * まだ一度も話しておらず、コーチも選んでいない人。
         * **ここで勝手に会話を始めない。** 選んでいない人の口調で話し出すことになる。
         */
        const firstRun = data.messages.length === 0 && !data.profile?.characterId;
        setNeedsCoach(firstRun);

        // 同意がまだの人には、ここで話しかけない。同意の画面が先に出て、同意した時に話し始める。
        const letModelOpen =
          data.messages.length === 0 && data.hasApiKey && !firstRun && hasConsent(data.profile);
        // **まだコーチを選んでいない人には出さない。** 選ぶ前の既定の口調で
        // 挨拶してしまい、選んだ直後に別人の言葉が残ることになる。
        if (!letModelOpen && !firstRun && data.profile && firstOpenToday()) {
          setGreeting(greetingFor(data.profile).text);
          greetingPending.current = true;
        }

        if (!data.hasApiKey) {
          setError('GEMINI_API_KEY が設定されていません。.env.local に Gemini API キーを入れてください。');
          return;
        }
        // キーの形式だけを理由に警告は出さない。
        // 形式は提供側の都合で変わるため、動いているのに警告が出ると、
        // 本当の問題があるかのように見えてしまう。
        // 実際に無効なら、最初の対話で Gemini 側の理由が表示される。
        // まだ一度も話していない人には、コーチ自身に最初の一言を書かせる。
        if (letModelOpen) await turn('');
      } catch (e) {
        setReady(true);
        setError(
          e instanceof Error && e.message
            ? e.message
            : 'コーチに接続できませんでした。通信環境を確認して、もう一度開いてください。',
        );
      }
    })();
  }, [turn, syncStrava]);

  const reset = useCallback(async () => {
    await fetch('/api/profile', { method: 'DELETE' });
    setMessages([]);
    setProfile(null);
    setStreamingText(null);
    setError(null);
    setErrorDetail(null);
    /**
     * **消したら、最初の画面に戻す。** ここで勝手に話し始めない。
     * 記録と一緒に同意も消えているので、話し始めてもサーバーに断られる。
     * コーチ選びと同意から、もう一度。
     */
    setNeedsCoach(true);
  }, []);

  const updateProfile = useCallback(async (edit: ProfileUpdate) => {
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

  /**
   * コーチを決めて、その人に最初の一言を書いてもらう。
   * **選んだ直後に黙られると、何が起きたのか分からない。**
   */
  const chooseCoach = useCallback(
    async (characterId: string, displayName?: string) => {
      // 名前と同意は、最初の一言より先に保存する。
      // **同意が先に無いと、サーバーは体の情報を預からない**（最初の一言そのものが断られる）。
      await updateProfile(
        displayName ? { characterId, displayName, consent: true } : { characterId, consent: true },
      );
      setNeedsCoach(false);
      await turn('');
    },
    [updateProfile, turn],
  );

  /**
   * すでに使っている人の同意。
   * まだ一度も話していない人なら、同意した時点でコーチに話し始めてもらう。
   * **起動時には話しかけていない**（同意の無い人の会話は、サーバーが断るため）。
   */
  const giveConsent = useCallback(async () => {
    await updateProfile({ consent: true });
    if (messages.length === 0) await turn('');
  }, [updateProfile, turn, messages]);

  /**
   * 通知を受け取る時刻。
   * **カルテの保存とは別に、その場で送る。** ここは設定であって、
   * 「編集して保存」の流れに入れると、変えたつもりで変わっていない事故が起きる。
   */
  const saveNotifyHour = useCallback(async (hour: number) => {
    try {
      const response = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifyHour: hour }),
      });
      const data = (await response.json()) as { profile?: RunnerProfile; error?: string };
      if (!response.ok || !data.profile) throw new Error(data.error ?? '通知の時刻を保存できませんでした。');
      setProfile(data.profile);
    } catch (e) {
      setError(e instanceof Error ? e.message : '通知の時刻を保存できませんでした。');
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
      if (!response.ok || !data.profile) throw new Error(data.error ?? '体重を記録できませんでした。');
      setProfile(data.profile);
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
    greeting,
    needsCoach,
    giveConsent,
    chooseCoach,
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
    gear,
    auth,
    syncStrava,
    importFiles,
    disconnectStrava,
    syncing,
    syncMessage,
    clearSyncMessage: () => {
      setSyncMessage(null);
      setNeedsDeviceGuide(false);
    },
    needsDeviceGuide,
    saveWeight,
    savingWeight,
  };
}
