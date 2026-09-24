import type { NextRequest } from 'next/server';
import { cleanEnv } from '@/lib/build-info';
import { getStore } from '@/lib/store';
import { markNotified, nudgeFor } from '@/lib/nudge';
import { applyOutcomes, isPushConfigured, sendPush, type PushOutcome } from '@/lib/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** 人数ぶん回るので、既定の実行時間では足りないことがある。 */
export const maxDuration = 300;

/** 1回で見る人数の上限。増えたら、ここを分割して回す。 */
const MAX_USERS = 500;

/**
 * 誰に何を送るかは nudge.ts が決め、ここは配るだけ。
 *
 * **CRON_SECRET が無い環境では動かしません。** 誰でも叩ける通知の送信口は、
 * それ自体が嫌がらせの道具になる。
 */
function authorized(request: NextRequest): boolean {
  const secret = cleanEnv(process.env.CRON_SECRET);
  if (!secret) return false;
  const header = request.headers.get('authorization') ?? '';
  return header === `Bearer ${secret}`;
}

async function run(request: NextRequest): Promise<Response> {
  if (!authorized(request)) {
    return Response.json({ error: 'この操作は許可されていません。' }, { status: 401 });
  }
  if (!isPushConfigured()) {
    return Response.json({ error: '通知の鍵が設定されていません。' }, { status: 503 });
  }

  const store = getStore();
  if (!store.listProfiles || !store.saveProfile) {
    return Response.json({ error: 'この保存先では一括送信ができません。' }, { status: 501 });
  }

  const now = new Date();
  const people = await store.listProfiles(MAX_USERS);

  let sent = 0;
  let skipped = 0;
  let dropped = 0;

  for (const { userId, profile } of people) {
    const subscriptions = profile.pushSubscriptions ?? [];
    if (subscriptions.length === 0) continue;

    // 1人ぶんの失敗で、残りの人の通知まで止めない。
    let nudge;
    try {
      nudge = nudgeFor(profile, now);
    } catch (error) {
      console.error('[coach] nudge failed', userId, error);
      continue;
    }
    if (!nudge) {
      skipped += 1;
      continue;
    }

    const outcomes: { endpoint: string; outcome: PushOutcome }[] = [];
    for (const subscription of subscriptions) {
      const outcome = await sendPush(
        subscription,
        { title: nudge.title, body: nudge.body, tag: nudge.tag, url: '/' },
      );
      outcomes.push({ endpoint: subscription.endpoint, outcome });
      if (outcome === 'sent') sent += 1;
      if (outcome === 'gone') dropped += 1;
    }

    // 届いた相手がいる時だけ「送った」ことにする。
    // 全部失敗しているのに記録すると、明日以降も送られないまま黙る。
    const delivered = outcomes.some((entry) => entry.outcome === 'sent');
    let next = applyOutcomes(profile, outcomes, now);
    if (delivered) next = markNotified(next, nudge.tag, now);

    try {
      await store.saveProfile(userId, next);
    } catch (error) {
      console.error('[coach] notify save failed', userId, error);
    }
  }

  return Response.json({ ok: true, people: people.length, sent, skipped, dropped });
}

/** Vercel の定期実行は GET で叩く。手で試す時のために POST も受ける。 */
export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
