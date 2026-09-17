import type { NextRequest } from 'next/server';
import { getStore } from '@/lib/store';
import { resolveUserId, userCookieHeader } from '@/lib/session';
import { toDisplayMessages } from '@/lib/profile';
import { FIRST_TURN_PROMPT } from '@/lib/prompt';
import { CoachApiError, MissingApiKeyError, runCoachTurn } from '@/lib/gemini';
import { getBuildInfo } from '@/lib/build-info';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 思考ありのモデルはひと呼吸置くことがある。既定の短い上限で切られないようにする。
export const maxDuration = 60;

/** 画面の初期表示用。これまでの会話とカルテを返す。 */
export async function GET(request: NextRequest) {
  const { userId, isNew } = resolveUserId(request);
  const state = await getStore().load(userId);
  const build = getBuildInfo();
  return Response.json(
    {
      messages: toDisplayMessages(state.history),
      profile: state.profile,
      hasApiKey: build.hasApiKey,
      build,
    },
    { headers: isNew ? { 'Set-Cookie': userCookieHeader(userId) } : undefined },
  );
}

interface ChatRequestBody {
  message?: string;
}

/**
 * 1ターン分の対話。NDJSON で1行1イベントを流す。
 *  {"type":"delta","text":"..."}   本文の断片
 *  {"type":"done","profile":{...}} カルテの最新状態
 *  {"type":"error","message":"..."}
 */
export async function POST(request: NextRequest) {
  const { userId, isNew } = resolveUserId(request);
  const store = getStore();

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return Response.json({ error: 'リクエストの形式が正しくありません。' }, { status: 400 });
  }

  const state = await store.load(userId);
  const message = (body.message ?? '').trim();

  // 初回だけ、こちらから声をかける。
  const userText = message || (state.history.length === 0 ? FIRST_TURN_PROMPT : '');
  if (!userText) {
    return Response.json({ error: 'メッセージが空です。' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      try {
        const result = await runCoachTurn({
          state,
          userText,
          onDelta: (delta) => send({ type: 'delta', text: delta }),
        });
        await store.save(userId, result.state);
        send({
          type: 'done',
          profile: result.state.profile,
          meta: { usedTools: result.usedTools, rewrites: result.rewrites },
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
      } finally {
        controller.close();
      }
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
