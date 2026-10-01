import { after } from 'next/server';
import type { NextRequest } from 'next/server';
import { getStore } from '@/lib/store';
import { receiveStravaEvent } from '@/lib/arrival';
import { isStravaConfigured } from '@/lib/strava';
import { challengeFor, currentSubscriptionId, parseEvent } from '@/lib/strava-webhook';
import { countEvent, counterOf } from '@/lib/ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** 返事は即返すが、そのあとの取り込みに時間が要る。 */
export const maxDuration = 120;

/**
 * Strava が練習の到着を知らせてくる口。
 *
 * **ここが、このアプリで唯一「本人が何もしていない時に動く」入口。**
 * 走り終えて時計を止めた数十秒後に、記録のほうから届く。
 *
 * 守ること:
 *  - 確認の問い合わせ（GET）には、合言葉が合った時だけ合言葉を返す。
 *  - 通知（POST）には**必ず 200 を返す**。遅れても、断っても、Strava は送り直してくる。
 *  - 取り込みは返事のあと（`after`）。2秒を超えると失敗扱いになる。
 */
export async function GET(request: NextRequest) {
  const challenge = challengeFor(new URL(request.url).searchParams);
  // 合言葉が合わない問い合わせには、何も返さない。
  if (!challenge) return new Response(null, { status: 403 });
  return Response.json(challenge);
}

export async function POST(request: NextRequest) {
  if (!isStravaConfigured()) return new Response('ok', { status: 200 });

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const event = parseEvent(body);
  if (event) {
    after(async () => {
      try {
        const store = getStore();
        const subscriberId = await currentSubscriptionId();
        const result = await receiveStravaEvent(event, { store, subscriberId });
        if (result.imported > 0) {
          // 自動で入った分。**開かずに届いているか**は、ここが増えているかで分かる。
          await countEvent(counterOf(store), 'auto_import', result.imported);
        }
        console.info('[coach] strava webhook', {
          action: result.action,
          matched: result.matched,
          imported: result.imported,
          removed: result.removed,
          notified: result.notified,
          reason: result.reason,
        });
      } catch (error) {
        // ここで投げても誰も受け取らない。**残すだけ残して、黙って終わる。**
        console.error('[coach] strava webhook failed', error);
      }
    });
  }

  return new Response('ok', { status: 200 });
}
