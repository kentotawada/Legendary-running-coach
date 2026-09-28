import type { NextRequest } from 'next/server';
import { withConsent } from '@/lib/legal';
import { countEvent, counterOf } from '@/lib/ops';
import { getStore, loadForSession } from '@/lib/store';
import { resolveUserId, userCookieHeader } from '@/lib/session';
import { storageErrorResponse } from '@/lib/storage-error';
import {
  applyProfileUpdate,
  publicProfile,
  replaceInjuryHistory,
  replaceRaces,
  setGoal,
  setPhase,
} from '@/lib/profile';
import { parseDuration } from '@/lib/goals';
import type { CoachingPhase, GoalKind, RacePriority, RunnerGoal } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** コーチが今なにを把握しているかを、いつでも本人が確認できるようにする。 */
export async function GET(request: NextRequest) {
  const session = await resolveUserId(request);
  const { userId, isNew } = session;

  let state;
  try {
    state = await loadForSession(session);
  } catch (error) {
    return storageErrorResponse(error, 'カルテを読み込めませんでした');
  }

  return Response.json(
    // 接続の鍵を含むので、必ず publicProfile を通す。
    { profile: publicProfile(state.profile) },
    { headers: isNew ? { 'Set-Cookie': userCookieHeader(userId) } : undefined },
  );
}

const GOAL_KINDS: GoalKind[] = ['race', 'time', 'health', 'habit', 'none'];
const RACE_PRIORITIES: RacePriority[] = ['A', 'B', 'C'];
/** 1シーズンで現実的に走れる数を大きく超える登録は、入力ミスとして弾く。 */
const MAX_RACES = 30;

interface ProfilePatchBody {
  goal?: {
    kind?: string;
    summary?: string;
    targetTime?: string;
    targetPace?: string;
    why?: string;
  } | null;
  races?: unknown;
  characterId?: unknown;
  /** 通知を受け取る時刻（0〜23）。 */
  notifyHour?: unknown;
  /** 規約とプライバシーポリシーに同意した。true だけを受け付ける。版と時刻はサーバーが決める。 */
  consent?: unknown;
  injuryHistory?: unknown;
  maxHr?: unknown;
  restingHr?: unknown;
  lthr?: unknown;
  weeklyVolumeKm?: unknown;
  displayName?: unknown;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function count(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

/** 目標の種類から、指導スタイルの初期値を決める。 */
function phaseForGoal(kind: GoalKind): CoachingPhase {
  if (kind === 'health' || kind === 'habit') return 'habit';
  if (kind === 'none') return 'unknown';
  return 'goal';
}

/**
 * 本人がカルテから設定を書き換える。
 * 目標レベルが変われば、コーチが使う基準ペースもここから自動で切り替わる。
 */
export async function PATCH(request: NextRequest) {
  const session = await resolveUserId(request);
  const { userId, isNew } = session;
  const store = getStore();

  let body: ProfilePatchBody;
  try {
    body = (await request.json()) as ProfilePatchBody;
  } catch {
    return Response.json({ error: 'リクエストの形式が正しくありません。' }, { status: 400 });
  }

  const now = new Date();

  let state;
  try {
    state = await loadForSession(session);
  } catch (error) {
    return storageErrorResponse(error, 'カルテを読み込めませんでした');
  }

  let profile = state.profile;

  if (body.goal !== undefined) {
    if (body.goal === null) {
      profile = setGoal(profile, undefined, now);
    } else {
      const kind = (GOAL_KINDS as string[]).includes(body.goal.kind ?? '')
        ? (body.goal.kind as GoalKind)
        : 'time';
      const targetTime = text(body.goal.targetTime);
      if (targetTime && parseDuration(targetTime) === undefined) {
        return Response.json(
          { error: '目標タイムは 3:29:59 のように「時:分:秒」で入力してください。' },
          { status: 400 },
        );
      }

      const goal: RunnerGoal = {
        kind,
        summary: text(body.goal.summary) ?? '目標',
        targetTime,
        targetPace: text(body.goal.targetPace),
        why: text(body.goal.why),
      };
      profile = setGoal(profile, goal, now);
      profile = setPhase(profile, phaseForGoal(kind), '本人がカルテで目標を設定した', now);
    }
  }

  if (Array.isArray(body.races)) {
    const races = body.races
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        id: text(item.id),
        name: text(item.name) ?? '',
        date: text(item.date) ?? '',
        distance: text(item.distance),
        targetTime: text(item.targetTime),
        priority: (RACE_PRIORITIES as string[]).includes(text(item.priority) ?? '')
          ? (item.priority as RacePriority)
          : ('A' as RacePriority),
        note: text(item.note),
      }))
      .filter((race) => race.name && race.date);

    const invalid = races.find((race) => !/^\d{4}-\d{2}-\d{2}$/.test(race.date));
    if (invalid) {
      return Response.json(
        { error: `「${invalid.name}」の開催日を選んでください。` },
        { status: 400 },
      );
    }
    if (races.length > MAX_RACES) {
      return Response.json({ error: `登録できる大会は${MAX_RACES}件までです。` }, { status: 400 });
    }

    const badTime = races.find((race) => race.targetTime && parseDuration(race.targetTime) === undefined);
    if (badTime) {
      return Response.json(
        { error: `「${badTime.name}」の目標タイムは 3:29:59 のように「時:分:秒」で入力してください。` },
        { status: 400 },
      );
    }

    profile = replaceRaces(profile, races, now);
  }

  if (Array.isArray(body.injuryHistory)) {
    profile = replaceInjuryHistory(
      profile,
      body.injuryHistory.filter((item): item is string => typeof item === 'string'),
      now,
    );
  }

  /**
   * 同意。**画面からは「同意した」という事実だけを受け取る。**
   * どの版に、いつ同意したかはサーバーが決める。版や日付を画面から受け取ると、
   * 同意していない版に同意したことにできてしまう。
   */
  // 同意した人と、はじめてコーチを選んだ人（＝使い始めた人）を数える。
  // 最初の画面でどれだけ離れているかは、この2つと訪問数の差で分かる。
  const events: string[] = [];
  if (body.consent === true) {
    if (!profile.consent) events.push('consent');
    profile = withConsent(profile, now);
  }
  if (typeof body.characterId === 'string' && body.characterId.trim() && !profile.characterId) {
    events.push('signup');
  }

  /**
   * 通知を受け取る時刻。
   * **カルテの他の項目と混ぜない。** ここだけは端末の設定に近い性質で、
   * 対話の中でコーチが書き換えるものではない。
   */
  if (typeof body.notifyHour === 'number' && Number.isFinite(body.notifyHour)) {
    const hour = Math.min(23, Math.max(0, Math.floor(body.notifyHour)));
    profile = {
      ...profile,
      notifications: { ...(profile.notifications ?? {}), hour },
      updatedAt: now.toISOString(),
    };
  }

  /**
   * 名前を消す。
   *
   * applyProfileUpdate は undefined を「まだ分からない」として扱い、既存の値を残す。
   * それは会話から拾う時には正しいが、**カルテの入力欄を空にした時に消えないと、
   * 一度付けた名前を外せない。** 空文字で送られた時だけ、はっきり消す。
   */
  if (typeof body.displayName === 'string' && !body.displayName.trim() && profile.displayName) {
    profile = { ...profile, displayName: undefined, updatedAt: now.toISOString() };
  }

  profile = applyProfileUpdate(
    profile,
    {
      displayName: text(body.displayName),
      characterId: text(body.characterId),
      maxHr: count(body.maxHr),
      restingHr: count(body.restingHr),
      lthr: count(body.lthr),
      weeklyVolumeKm: count(body.weeklyVolumeKm),
    },
    now,
  );

  try {
    await store.save(userId, { ...state, profile }, session.authUserId);
  } catch (error) {
    return storageErrorResponse(error, '設定を保存できませんでした');
  }
  for (const name of events) await countEvent(counterOf(store), name, 1, now);

  return Response.json(
    { profile: publicProfile(profile) },
    { headers: isNew ? { 'Set-Cookie': userCookieHeader(userId) } : undefined },
  );
}

/** 記録を消す権利は本人にある。 */
export async function DELETE(request: NextRequest) {
  const session = await resolveUserId(request);
  try {
    await getStore().reset(session.userId);
  } catch (error) {
    return storageErrorResponse(error, '記録を消去できませんでした');
  }
  return Response.json({ ok: true });
}
