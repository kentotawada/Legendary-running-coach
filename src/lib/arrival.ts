/**
 * 届いた通知を、カルテに反映するところ。
 *
 * **ここから先は、本人が何もしていない時間に動く。**
 * だから、間違えた時に「やり直してください」と言う相手がいない。
 * 失敗しても、持っているものを壊さないことだけを守る。
 *
 *  - 誰の通知か分からなければ、**何もしない。**
 *  - 消す方向の指示は、購読IDが一致した時だけ通す（Strava の通知には署名が無い）。
 *  - 1人ぶんの失敗を、ここから外へ投げない。webhook は常に 200 を返す。
 */

import type { CoachStore } from './store';
import type { ActivityLog, RunnerProfile } from './types';
import { removeExternalActivity } from './profile';
import { syncStrava } from './sync';
import { actionFor, isDestructive, type EventAction, type StravaEvent } from './strava-webhook';
import { ARRIVAL_TAG, addressed, arrivalNudge, markNotified } from './nudge';
import { applyOutcomes, sendPush, type PushOutcome } from './push';

/** 一度に見る人数の上限。push/send と同じ。 */
const MAX_USERS = 500;

type ProfileStore = Pick<CoachStore, 'listProfiles' | 'saveProfile'>;

export interface ArrivalOptions {
  store: ProfileStore;
  now?: Date;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  /** 差し替え可能にしておく。テストで本当に通知を飛ばさないため。 */
  push?: typeof sendPush;
  /**
   * いま有効な購読のID。
   * 分からない時は undefined のままでよい。**その時は消す方向の指示を通さない。**
   */
  subscriberId?: number;
}

export interface ArrivalResult {
  action: EventAction;
  /** 持ち主のカルテが見つかったか。 */
  matched: boolean;
  imported: number;
  removed: number;
  disconnected: boolean;
  notified: boolean;
  /** 動かなかった理由。ログに残して、設定の取り違えを見分けられるようにする。 */
  reason?: 'no-store' | 'unknown-athlete' | 'not-connected' | 'unverified' | 'nothing';
}

const NOTHING: Omit<ArrivalResult, 'action'> = {
  matched: false,
  imported: 0,
  removed: 0,
  disconnected: false,
  notified: false,
};

/** athleteId からカルテを探す。**アプリにひとつの購読を、人ごとに振り分ける唯一の手段。** */
async function findByAthlete(
  store: ProfileStore,
  athleteId: number,
): Promise<{ userId: string; profile: RunnerProfile } | null> {
  if (!store.listProfiles) return null;
  const people = await store.listProfiles(MAX_USERS);
  return (
    people.find((entry) => entry.profile.connections?.strava?.athleteId === athleteId) ?? null
  );
}

/** 連携だけを外す。**練習の記録は消さない。** つなぎ直せば続きから使える。 */
function withoutStrava(profile: RunnerProfile, now: Date): RunnerProfile {
  const connections = { ...profile.connections };
  delete connections.strava;
  return {
    ...profile,
    connections: Object.keys(connections).length > 0 ? connections : undefined,
    updatedAt: now.toISOString(),
  };
}

/** 取り込んだ練習のうち、この通知が指していたもの。 */
function arrived(profile: RunnerProfile, objectId: number): ActivityLog | undefined {
  return profile.activities.find((activity) => activity.externalId === `strava:${objectId}`);
}

export async function receiveStravaEvent(
  event: StravaEvent,
  options: ArrivalOptions,
): Promise<ArrivalResult> {
  const { store, now = new Date(), env = process.env, fetchImpl, push = sendPush } = options;
  const action = actionFor(event);
  if (action === 'ignore') return { action, ...NOTHING, reason: 'nothing' };

  if (!store.listProfiles || !store.saveProfile) {
    return { action, ...NOTHING, reason: 'no-store' };
  }

  // **署名が無いので、消す方向の指示は購読IDで確かめる。**
  // 取り込みは、こちらの鍵で Strava に取りに行くだけなので、偽の通知でも害が無い。
  if (isDestructive(action) && (options.subscriberId === undefined || event.subscriberId !== options.subscriberId)) {
    return { action, ...NOTHING, reason: 'unverified' };
  }

  const found = await findByAthlete(store, event.ownerId);
  if (!found) return { action, ...NOTHING, reason: 'unknown-athlete' };

  const { userId, profile } = found;

  if (action === 'disconnect') {
    await store.saveProfile(userId, withoutStrava(profile, now));
    return { action, ...NOTHING, matched: true, disconnected: true };
  }

  if (action === 'remove') {
    const next = removeExternalActivity(profile, `strava:${event.objectId}`, now);
    if (next === profile) return { action, ...NOTHING, matched: true, reason: 'nothing' };
    await store.saveProfile(userId, next);
    return { action, ...NOTHING, matched: true, removed: 1 };
  }

  if (!profile.connections?.strava?.secret) {
    return { action, ...NOTHING, matched: true, reason: 'not-connected' };
  }

  const result = await syncStrava(profile, { now, env, fetchImpl });
  let next = result.profile;

  /**
   * 届いたことを、その場で伝える。
   *
   * **通知が出せなくても、取り込みは成立している。** 次に開いた時にはもう入っている。
   * ここで失敗しても、保存までは必ず進める。
   */
  let notified = false;
  const activity = arrived(next, event.objectId);
  const subscriptions = next.pushSubscriptions ?? [];
  if (result.imported > 0 && activity && subscriptions.length > 0) {
    const nudge = arrivalNudge(next, activity, now);
    if (nudge) {
      const named = addressed(next, nudge);
      const outcomes: { endpoint: string; outcome: PushOutcome }[] = [];
      for (const subscription of subscriptions) {
        const outcome = await push(
          subscription,
          { title: named.title, body: named.body, tag: named.tag, url: '/' },
          env,
        );
        outcomes.push({ endpoint: subscription.endpoint, outcome });
      }
      notified = outcomes.some((entry) => entry.outcome === 'sent');
      next = applyOutcomes(next, outcomes, now);
      // 届いた相手がいる時だけ「送った」ことにする。
      // 全部失敗しているのに記録すると、今日の定期便まで黙る。
      if (notified) next = markNotified(next, ARRIVAL_TAG, now);
    }
  }

  await store.saveProfile(userId, next);
  return {
    action,
    matched: true,
    imported: result.imported,
    removed: 0,
    disconnected: false,
    notified,
  };
}
