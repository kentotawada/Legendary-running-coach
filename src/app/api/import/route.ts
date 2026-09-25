import type { NextRequest } from 'next/server';
import { getStore, loadForSession } from '@/lib/store';
import { resolveUserId, userCookieHeader } from '@/lib/session';
import { publicProfile } from '@/lib/profile';
import { storageErrorResponse } from '@/lib/storage-error';
import {
  MAX_LAPS,
  MAX_SERIES_POINTS,
  describeImport,
  importWorkouts,
  type ImportedWorkout,
  type RunningDynamics,
  type WorkoutLap,
  type WorkoutSample,
} from '@/lib/workout';
import type { WorkoutSource } from '@/lib/workout';
import type { ActivityType } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 正規化された練習を受け取る、ひとつの入口。
 *
 * ここへ投げれば入る、という形にしておくことで、
 * **取り込み元が増えても、取り込みの作法は1つのまま**でいられます。
 * 今はブラウザで読んだ GPX / TCX が来ます。
 * iPhone のヘルスケアを読むアプリも、同じ形をここへ投げます。
 *
 * ファイルそのものは受け取りません。ロング走の GPX は数MBあり、
 * 送信の上限に当たるためです。読むのは手元で済ませ、ここには数値だけが来ます。
 */

/** 一度に受け取る上限。数年分を一括で入れる時でも、何回かに分けてもらう。 */
const MAX_WORKOUTS = 300;

const TYPES: ActivityType[] = ['run', 'walk', 'cross', 'strength', 'stretch', 'rest'];
const SOURCES: WorkoutSource[] = ['health', 'file'];

/** 上限は「あり得ない値」を弾くためのもの。正しい記録を落とさない幅に取る。 */
const MAX_DISTANCE_M = 500_000;
const MAX_DURATION_SEC = 24 * 3600;

/**
 * フォームの指標の上限。
 * **読み違えた値をカルテへ入れないための最後の関門。**
 * 取り出す側（fit.ts）でも範囲を見ているが、入口でも重ねて見る。
 */
const MAX_DYNAMICS: Record<keyof RunningDynamics, number> = {
  powerW: 900,
  verticalOscillationCm: 20,
  groundContactMs: 450,
  balanceLeft: 65,
  verticalRatio: 20,
  stepLengthCm: 250,
};

function cleanDynamics(raw: unknown): RunningDynamics | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const item = raw as Record<string, unknown>;

  const clean: RunningDynamics = {};
  for (const key of Object.keys(MAX_DYNAMICS) as (keyof RunningDynamics)[]) {
    const value = positive(item[key], MAX_DYNAMICS[key]);
    if (value !== undefined) clean[key] = value;
  }
  return Object.values(clean).some((value) => value !== undefined) ? clean : undefined;
}

function positive(value: unknown, limit: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(value, limit);
}

/**
 * 区間。**ここが、平均では絶対に復元できない部分。**
 * ペースは受け取らず、距離と時間からサーバーで計算する（送り手の計算を信じない）。
 */
function cleanLaps(raw: unknown): WorkoutLap[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const laps = raw
    .slice(0, MAX_LAPS)
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const lap = item as Record<string, unknown>;
      const distanceM = positive(lap.distanceM, MAX_DISTANCE_M);
      const durationSec = positive(lap.durationSec, MAX_DURATION_SEC);
      if (distanceM === undefined || durationSec === undefined) return null;
      const clean: WorkoutLap = {
        distanceM,
        durationSec,
        avgHr: positive(lap.avgHr, 300),
        maxHr: positive(lap.maxHr, 300),
        cadence: positive(lap.cadence, 400),
        ...(cleanDynamics(lap) ?? {}),
      };
      return clean;
    })
    .filter((lap): lap is WorkoutLap => lap !== null);

  return laps.length > 1 ? laps : undefined;
}

/** 走行中の推移。送る側で間引いてある前提で、念のためここでも上限を効かせる。 */
function cleanSamples(raw: unknown): WorkoutSample[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const samples = raw
    .slice(0, MAX_SERIES_POINTS + 1)
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const point = item as Record<string, unknown>;
      const t = typeof point.t === 'number' && Number.isFinite(point.t) && point.t >= 0 ? point.t : null;
      if (t === null) return null;
      const clean: WorkoutSample = {
        t: Math.min(t, MAX_DURATION_SEC),
        d: positive(point.d, MAX_DISTANCE_M),
        hr: positive(point.hr, 300),
        cadence: positive(point.cadence, 400),
      };
      return clean;
    })
    .filter((point): point is WorkoutSample => point !== null);

  return samples.length > 1 ? samples : undefined;
}

/**
 * 送られてきた1件を検める。
 * **外から来た数値をそのままカルテへ入れない。** 形の違うものは、黙って落とす。
 */
function clean(raw: unknown): ImportedWorkout | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;

  const externalId = typeof item.externalId === 'string' ? item.externalId.slice(0, 200) : '';
  // 日付ではなく時刻を受け取る。何日の練習かは、走る人の時刻でサーバーが決める。
  const startedAt = typeof item.startedAt === 'string' ? item.startedAt : '';
  if (!externalId || !startedAt || Number.isNaN(Date.parse(startedAt))) return null;

  const type = TYPES.includes(item.type as ActivityType) ? (item.type as ActivityType) : null;
  const source = SOURCES.includes(item.source as WorkoutSource)
    ? (item.source as WorkoutSource)
    : null;
  if (!type || !source) return null;

  return {
    externalId,
    startedAt,
    type,
    source,
    distanceM: positive(item.distanceM, MAX_DISTANCE_M),
    durationSec: positive(item.durationSec, MAX_DURATION_SEC),
    avgHr: positive(item.avgHr, 300),
    maxHr: positive(item.maxHr, 300),
    cadence: positive(item.cadence, 400),
    elevationGainM: positive(item.elevationGainM, 20_000),
    name: typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 40) : undefined,
    laps: cleanLaps(item.laps),
    samples: cleanSamples(item.samples),
    dynamics: cleanDynamics(item.dynamics),
  };
}

export async function POST(request: NextRequest) {
  const session = await resolveUserId(request);

  let body: { workouts?: unknown };
  try {
    body = (await request.json()) as { workouts?: unknown };
  } catch {
    return Response.json({ error: 'リクエストの形式が正しくありません。' }, { status: 400 });
  }

  if (!Array.isArray(body.workouts)) {
    return Response.json({ error: '取り込む練習が入っていません。' }, { status: 400 });
  }
  if (body.workouts.length > MAX_WORKOUTS) {
    return Response.json(
      { error: `一度に取り込めるのは${MAX_WORKOUTS}件までです。何回かに分けてください。` },
      { status: 413 },
    );
  }

  const workouts = body.workouts
    .map(clean)
    .filter((workout): workout is ImportedWorkout => workout !== null);

  if (workouts.length === 0) {
    return Response.json({ error: '取り込める練習が見つかりませんでした。' }, { status: 400 });
  }

  let state;
  try {
    state = await loadForSession(session);
  } catch (error) {
    return storageErrorResponse(error, 'カルテを読み込めませんでした');
  }

  const result = importWorkouts(state.profile, workouts, new Date());

  try {
    await getStore().save(session.userId, { ...state, profile: result.profile }, session.authUserId);
  } catch (error) {
    return storageErrorResponse(error, '取り込んだ記録を保存できませんでした');
  }

  return Response.json(
    {
      ok: true,
      imported: result.imported,
      skipped: result.skipped,
      message: describeImport(result),
      // 接続の鍵を含むので、必ず publicProfile を通す。
      profile: publicProfile(result.profile),
    },
    { headers: session.isNew ? { 'Set-Cookie': userCookieHeader(session.userId) } : undefined },
  );
}
