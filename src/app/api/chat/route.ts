import type { NextRequest } from 'next/server';
import { getStore, loadForSession, rememberAttachments } from '@/lib/store';
import { resolveUserId, userCookieHeader } from '@/lib/session';
import { toDisplayMessages } from '@/lib/profile';
import { FIRST_TURN_PROMPT } from '@/lib/prompt';
import { CoachApiError, MissingApiKeyError, runCoachTurn } from '@/lib/gemini';
import { getBuildInfo } from '@/lib/build-info';
import { DEFAULT_IMAGE_MESSAGE, validateImages } from '@/lib/images';
import { affiliateConfigFromEnv, resolveGearCatalog } from '@/lib/gear';
import { isSupabaseConfigured } from '@/lib/supabase';
import { StorageError, storageErrorResponse } from '@/lib/storage-error';
import { dropLastUserTurn, rewindToLastUserTurn } from '@/lib/history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * 画像を何枚も読み取り、道具を呼び、必要なら書き直す。
 * これを60秒に収めようとすると、スクリーンショットを数枚送った時に
 * 実行基盤が途中で関数を打ち切り、画面には「通信に失敗しました」だけが残る。
 * 契約プランの上限を超える値は基盤側で丸められる。
 */
export const maxDuration = 300;

/** 沈黙が続くと途中の機器に切られる。生存確認を流し続ける間隔。 */
const HEARTBEAT_MS = 10_000;

/** 画面の初期表示用。これまでの会話とカルテを返す。 */
export async function GET(request: NextRequest) {
  const session = await resolveUserId(request);
  const { userId, isNew } = session;
  let state;
  try {
    state = await loadForSession(session);
  } catch (error) {
    return storageErrorResponse(error, 'これまでの記録を読み込めませんでした');
  }

  const build = getBuildInfo();
  return Response.json(
    {
      messages: toDisplayMessages(state.history, state.profile.attachments ?? []),
      profile: state.profile,
      hasApiKey: build.hasApiKey,
      build,
      // リンクはサーバー側で組み立てる。モデルにURLを書かせない。
      gear: resolveGearCatalog(affiliateConfigFromEnv()),
      auth: {
        available: isSupabaseConfigured(),
        isAuthenticated: session.isAuthenticated,
        email: session.email,
      },
    },
    { headers: isNew ? { 'Set-Cookie': userCookieHeader(userId) } : undefined },
  );
}

interface ChatRequestBody {
  message?: string;
  images?: unknown;
  /** 直前の返答を作り直す。同じ問いかけをもう一度投げ直す。 */
  regenerate?: unknown;
  /** 直前のやり取りを取り消してから送る。本文を書き直して送り直す時に使う。 */
  replaceLast?: unknown;
}

/**
 * 1ターン分の対話。NDJSON で1行1イベントを流す。
 *  {"type":"delta","text":"..."}   本文の断片
 *  {"type":"done","profile":{...}} カルテの最新状態
 *  {"type":"error","message":"..."}
 */
export async function POST(request: NextRequest) {
  const session = await resolveUserId(request);
  const { userId, isNew } = session;
  const store = getStore();

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return Response.json({ error: 'リクエストの形式が正しくありません。' }, { status: 400 });
  }

  const { images, thumbnails, error: imageError } = validateImages(body.images);
  if (imageError) {
    return Response.json({ error: imageError }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (payload: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        controller.close();
      };

      // 最初の一文字が出るまで数十秒かかることがある。
      // その間なにも流れないと、途中の機器や携帯回線に黙って切られる。
      const heartbeat = setInterval(() => send({ type: 'ping' }), HEARTBEAT_MS);

      // 記録の読み書きは、対話そのものとは別の失敗として扱う。
      // まとめて「接続できませんでした」にすると、原因の見当がつかなくなる。
      const sendStorageFailure = (error: unknown, what: string) => {
        console.error(`[coach] ${what}`, error);
        if (error instanceof StorageError) {
          send({ type: 'error', message: error.message, detail: `${error.detail}\n\n${error.hint}` });
        } else {
          send({
            type: 'error',
            message: `${what}。データベースの設定を確認してください。`,
            detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
          });
        }
      };

      let state;
      try {
        state = await loadForSession(session);
      } catch (error) {
        sendStorageFailure(error, 'これまでの記録を読み込めませんでした');
        finish();
        return;
      }

      const message = (body.message ?? '').trim();
      // 初回だけ、こちらから声をかける。
      let userText =
        message ||
        (images.length > 0 ? DEFAULT_IMAGE_MESSAGE : '') ||
        (state.history.length === 0 ? FIRST_TURN_PROMPT : '');

      // 作り直しは、直前の返答を無かったことにして同じ問いかけを投げ直す。
      if (body.regenerate === true) {
        const rewound = rewindToLastUserTurn(state.history);
        if (!rewound) {
          send({ type: 'error', message: '作り直せる返答がありません。' });
          finish();
          return;
        }
        state = { ...state, history: rewound.history };
        userText = rewound.userText;
      } else if (body.replaceLast === true) {
        // 書き直して送り直す。古い方を残すと、コーチが両方を読んで混乱する。
        state = { ...state, history: dropLastUserTurn(state.history) };
      }

      if (!userText) {
        send({ type: 'error', message: 'メッセージが空です。' });
        finish();
        return;
      }

      // 添付があるターンだけ、見返し用の控えに id を振る。
      const attachmentGroupId =
        images.length > 0 && thumbnails.length > 0
          ? `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
          : undefined;

      let result;
      try {
        result = await runCoachTurn({
          state,
          userText,
          images,
          attachmentGroupId,
          onDelta: (delta) => send({ type: 'delta', text: delta }),
        });
      } catch (error) {
        if (error instanceof MissingApiKeyError) {
          send({ type: 'error', message: error.message });
        } else if (error instanceof CoachApiError) {
          // 原因が分からないまま詰まるのが一番困る。翻訳した理由と生のメッセージを両方返す。
          console.error('[coach] turn failed', error.status, error.detail);
          send({ type: 'error', message: error.message, detail: error.detail });
        } else {
          console.error('[coach] turn failed', error);
          // detail が空だと画面に詳細が出ず、原因の切り分けができなくなる。必ず何か入れる。
          const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
          send({
            type: 'error',
            message: 'コーチへの接続がうまくいきませんでした。少し時間をおいて、もう一度話しかけてください。',
            detail: (raw.trim() || '詳細不明のエラー').slice(0, 500),
          });
        }
        finish();
        return;
      }

      // 送った画像を後から開き直せるよう、小さくした控えを残す。
      // 本体は保存しない（すぐに保存先が膨れる）ので、これが唯一の手がかりになる。
      result.state.profile = rememberAttachments(result.state.profile, attachmentGroupId, thumbnails);

      // ここまで来たらコーチの返答は届いている。
      // 保存に失敗しても、返答を無かったことにはしない。
      let saved = true;
      try {
        await store.save(userId, result.state, session.authUserId);
      } catch (error) {
        saved = false;
        sendStorageFailure(error, '返答は届きましたが、記録の保存に失敗しました');
      }

      send({
        type: 'done',
        profile: result.state.profile,
        saved,
        // 流し終えた後に、サーバー側で整えた最終形を渡す。
        // 商品の名札（p1）を本当の商品名に差し替えた結果が、ここで初めて確定する。
        text: result.text,
        meta: { usedTools: result.usedTools, rewrites: result.rewrites },
      });
      finish();
    },
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    'X-Accel-Buffering': 'no',
  };
  if (isNew) headers['Set-Cookie'] = userCookieHeader(userId);

  return new Response(stream, { headers });
}
