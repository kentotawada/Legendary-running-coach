import type { NextRequest } from 'next/server';
import { coachDate } from '@/lib/day';
import { clientAddress, placeId } from '@/lib/quota';
import { counterOf, getOps } from '@/lib/ops';
import { resolveUserId } from '@/lib/session';
import { getStore } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 同じ回線から1日に受け付ける報告の数。壊れた画面が同じ報告を連打しても、表が埋まらないように。 */
const REPORTS_PER_PLACE = 30;

/**
 * 画面で起きた不具合を受け取る（components/ErrorReporter.tsx）。
 *
 * **サーバー側の失敗は、サーバーが自分で残している。** ここに来るのは、
 * 画面の中で止まってしまい、サーバーまで何も届かない種類の不具合。
 * これが無いと、「開いたら真っ白」は、利用者が黙って離れるまで誰にも分からない。
 */
export async function POST(request: NextRequest) {
  let body: { message?: unknown; stack?: unknown; source?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 204 });
  }
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return new Response(null, { status: 204 });

  // 回線ごとに数を抑える。数えられない時は、受け付けない側に倒す（ここは無くても困らない）。
  const counter = counterOf(getStore());
  const address = clientAddress(request.headers);
  if (counter && address) {
    const day = coachDate();
    try {
      const count = await counter.bumpUsage(`reports:${day}:place:${placeId(address, day)}`);
      if (count > REPORTS_PER_PLACE) return new Response(null, { status: 204 });
    } catch {
      return new Response(null, { status: 204 });
    }
  }

  const session = await resolveUserId(request).catch(() => null);
  try {
    await getOps().record('error', {
      userId: session?.userId,
      payload: {
        where: 'browser',
        message,
        stack: typeof body.stack === 'string' ? body.stack.split('\n').slice(0, 8).join('\n') : undefined,
        source: typeof body.source === 'string' ? body.source : undefined,
        agent: request.headers.get('user-agent')?.slice(0, 200) ?? undefined,
      },
    });
  } catch (error) {
    console.error('[report] 不具合を記録できませんでした', error);
  }
  // 画面には何も返さない。報告の成否で、画面の動きを変えない。
  return new Response(null, { status: 204 });
}
