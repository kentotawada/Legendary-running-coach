import type { NextRequest } from 'next/server';
import { getStore, loadForSession } from '@/lib/store';
import { resolveUserId, userCookieHeader } from '@/lib/session';
import { storageErrorResponse } from '@/lib/storage-error';
import { applyProfileUpdate, replaceInjuryHistory, replaceRaces, setGoal, setPhase } from '@/lib/profile';
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
    { profile: state.profile },
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

  return Response.json(
    { profile },
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
