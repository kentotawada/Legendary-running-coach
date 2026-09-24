import type { NextRequest } from 'next/server';
import { getStore, loadForSession } from '@/lib/store';
import { resolveUserId, userCookieHeader } from '@/lib/session';
import { publicProfile } from '@/lib/profile';
import { storageErrorResponse } from '@/lib/storage-error';
import { StravaError, isStravaConfigured } from '@/lib/strava';
import { describeSync, syncStrava } from '@/lib/sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** 90日分を初回に取りに行くので、既定の実行時間では足りないことがある。 */
export const maxDuration = 120;

/**
 * Strava から取り込む。
 *
 * 画面を開いた時にも黙って走るので、**何も無ければ何も言わない**。
 * 「新着0件」を毎回知らせるのは、ただの雑音になる。
 */
export async function POST(request: NextRequest) {
  const session = await resolveUserId(request);

  if (!isStravaConfigured()) {
    return Response.json({ error: 'このアプリでは Strava 連携が設定されていません。' }, { status: 503 });
  }

  let state;
  try {
    state = await loadForSession(session);
  } catch (error) {
    return storageErrorResponse(error, 'カルテを読み込めませんでした');
  }

  if (!state.profile.connections?.strava?.secret) {
    return Response.json({ error: 'Strava につながっていません。' }, { status: 409 });
  }

  try {
    const result = await syncStrava(state.profile, { now: new Date() });
    try {
      await getStore().save(session.userId, { ...state, profile: result.profile }, session.authUserId);
    } catch (error) {
      return storageErrorResponse(error, '取り込んだ記録を保存できませんでした');
    }

    const headers = session.isNew ? { 'Set-Cookie': userCookieHeader(session.userId) } : undefined;
    return Response.json(
      {
        ok: true,
        imported: result.imported,
        skipped: result.skipped,
        shoes: result.shoes,
        firstTime: result.firstTime,
        garminDetected: result.garminDetected,
        message: describeSync(result),
        // 鍵を含むので、必ず publicProfile を通す。
        profile: publicProfile(result.profile),
      },
      { headers },
    );
  } catch (error) {
    console.error('[coach] strava sync failed', error);
    if (error instanceof StravaError) {
      return Response.json({ error: error.message, detail: error.detail }, { status: error.status ?? 502 });
    }
    return Response.json(
      {
        error: 'Strava から取り込めませんでした。',
        detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      },
      { status: 502 },
    );
  }
}
