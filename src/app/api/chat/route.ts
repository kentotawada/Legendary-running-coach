import type { NextRequest } from 'next/server';
import { getStore, loadForSession } from '@/lib/store';
import { resolveUserId, userCookieHeader } from '@/lib/session';
import { toDisplayMessages } from '@/lib/profile';
import { FIRST_TURN_PROMPT } from '@/lib/prompt';
import { CoachApiError, MissingApiKeyError, runCoachTurn } from '@/lib/gemini';
import { getBuildInfo } from '@/lib/build-info';
import { DEFAULT_IMAGE_MESSAGE, validateImages } from '@/lib/images';
import { affiliateConfigFromEnv, resolveGearCatalog } from '@/lib/gear';
import { isSupabaseConfigured } from '@/lib/supabase';
import { StorageError, storageErrorResponse } from '@/lib/storage-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 思考ありのモデルはひと呼吸置くことがある。既定の短い上限で切られないようにする。
export const maxDuration = 60;

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
      messages: toDisplayMessages(state.history),
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

  const { images, error: imageError } = validateImages(body.images);
  if (imageError) {
    return Response.json({ error: imageError }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

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
        controller.close();
        return;
      }

      const message = (body.message ?? '').trim();
      // 初回だけ、こちらから声をかける。
      const userText =
        message ||
        (images.length > 0 ? DEFAULT_IMAGE_MESSAGE : '') ||
        (state.history.length === 0 ? FIRST_TURN_PROMPT : '');

      if (!userText) {
        send({ type: 'error', message: 'メッセージが空です。' });
        controller.close();
        return;
      }

      let result;
      try {
        result = await runCoachTurn({
          state,
          userText,
          images,
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
        controller.close();
        return;
      }

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
        meta: { usedTools: result.usedTools, rewrites: result.rewrites },
      });
      controller.close();
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
