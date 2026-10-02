import type { NextRequest } from 'next/server';
import { getStore, loadForSession } from '@/lib/store';
import { resolveUserId, userCookieHeader } from '@/lib/session';
import { publicProfile } from '@/lib/profile';
import { storageErrorResponse } from '@/lib/storage-error';
import { fetchWeather, isFresh } from '@/lib/weather';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 位置は、小数2桁まで。**それ以上の精度は、ただ家の場所を預かることになる。** */
function coarse(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

/**
 * いまの空気を取って、カルテに置く。
 *
 * **ここをサーバーでやるのは、コーチにも同じ空気を見せるため。**
 * 画面だけが暑さを知っていて、コーチが知らないと、
 * 「今日は15秒落として」と書いてあるのに本人に目標ペースを勧める、が起きる。
 */
export async function POST(request: NextRequest) {
  const session = await resolveUserId(request);

  let body: { lat?: unknown; lon?: unknown };
  try {
    body = (await request.json()) as { lat?: unknown; lon?: unknown };
  } catch {
    body = {};
  }

  let state;
  try {
    state = await loadForSession(session);
  } catch (error) {
    return storageErrorResponse(error, 'カルテを読み込めませんでした');
  }

  const lat = coarse(body.lat) ?? state.profile.location?.lat ?? null;
  const lon = coarse(body.lon) ?? state.profile.location?.lon ?? null;
  if (lat === null || lon === null) {
    return Response.json({ error: '場所が分かりません。' }, { status: 400 });
  }

  const now = new Date();
  // まだ新しければ、取りに行かない。1日に何度も開く人の分だけ外へ出ていくことになる。
  if (isFresh(state.profile.weather, now) && state.profile.location) {
    return Response.json({ profile: publicProfile(state.profile), cached: true });
  }

  const weather = await fetchWeather(lat, lon, undefined, now);
  const profile = {
    ...state.profile,
    location: { lat, lon },
    weather: weather ?? state.profile.weather,
    updatedAt: now.toISOString(),
  };

  try {
    await getStore().save(session.userId, { ...state, profile }, session.authUserId);
  } catch (error) {
    return storageErrorResponse(error, '場所を保存できませんでした');
  }

  return Response.json(
    { profile: publicProfile(profile), ok: Boolean(weather) },
    { headers: session.isNew ? { 'Set-Cookie': userCookieHeader(session.userId) } : undefined },
  );
}
