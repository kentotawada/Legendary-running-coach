import type { NextRequest } from 'next/server';
import { coachHour } from '@/lib/day';
import { loadForSession } from '@/lib/store';
import { notifyHourOf, nudgeStatus, type NudgeSkip } from '@/lib/nudge';
import { applyOutcomes, isPushConfigured, sendPush, type PushOutcome } from '@/lib/push';
import { resolveUserId } from '@/lib/session';
import { getStore } from '@/lib/store';
import { storageErrorResponse } from '@/lib/storage-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 通知が来ない時に、**どこで止まっているかを1回で確かめる**ための口。
 *
 * 通知が来ない理由は5つあって、外からは全部同じ「来ない」に見える。
 *  1. 端末の宛先がサーバーに登録できていない
 *  2. 鍵（VAPID）が入っていない
 *  3. 宛先が古くなって、配信側に拒否されている
 *  4. 決めた時刻より前、または今日はもう送った
 *  5. **そもそも知らせる用事が無い**（いちばん多く、しかも正常）
 *
 * 切り分けができないと、5番なのに鍵を疑って半日つぶすことになる。
 *
 * **自分の端末にしか送りません。** 誰かに送りつける道具にはしない。
 * だから定期実行の合言葉（CRON_SECRET）は要らず、本人の記録だけを見る。
 */
export async function POST(request: NextRequest) {
  if (!isPushConfigured()) {
    return Response.json(
      { error: '通知の鍵（VAPID）がこの環境に入っていません。' },
      { status: 503 },
    );
  }

  const session = await resolveUserId(request);
  let state;
  try {
    state = await loadForSession(session);
  } catch (error) {
    return storageErrorResponse(error, 'カルテを読み込めませんでした');
  }

  const profile = state.profile;
  const subscriptions = profile.pushSubscriptions ?? [];
  const now = new Date();

  // 今日の定期実行が何をするはずだったのか。**送信の成否とは別に、必ず返す。**
  const status = nudgeStatus(profile, now);
  const plan = {
    hour: coachHour(now),
    notifyHour: notifyHourOf(profile),
    skip: status.skip as NudgeSkip | null,
    title: status.nudge?.title ?? null,
  };

  if (subscriptions.length === 0) {
    return Response.json({
      devices: 0,
      sent: 0,
      gone: 0,
      failed: 0,
      plan,
    });
  }

  const outcomes: { endpoint: string; outcome: PushOutcome }[] = [];
  for (const subscription of subscriptions) {
    const outcome = await sendPush(subscription, {
      title: 'テスト送信',
      body: 'これが見えていれば、通知は届く状態です。',
      tag: 'test',
      url: '/',
    });
    outcomes.push({ endpoint: subscription.endpoint, outcome });
  }

  /**
   * 切れていた宛先は、ここで片付ける。
   * **試したついでに掃除しておかないと、次の朝も同じ宛先に送って同じように失敗する。**
   * ただし「送った」ことは記録しない。テストで今日の1通を使い切らせない。
   */
  const next = applyOutcomes(profile, outcomes, now);
  try {
    await getStore().save(session.userId, { ...state, profile: next }, session.authUserId);
  } catch {
    // 掃除に失敗しても、試した結果は返す。ここで止めると何も分からない。
  }

  const count = (outcome: PushOutcome) => outcomes.filter((entry) => entry.outcome === outcome).length;
  return Response.json({
    devices: subscriptions.length,
    sent: count('sent'),
    gone: count('gone'),
    failed: count('failed'),
    plan,
  });
}
