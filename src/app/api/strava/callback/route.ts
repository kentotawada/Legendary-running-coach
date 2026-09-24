import type { NextRequest } from 'next/server';
import { getStore, loadForSession } from '@/lib/store';
import { resolveUserId, userCookieHeader } from '@/lib/session';
import { siteOrigin } from '@/lib/site-url';
import { STRAVA_STATE_COOKIE, clearStateCookieHeader, stateMatches } from '@/lib/strava-state';
import { StravaError, exchangeCode, isStravaConfigured } from '@/lib/strava';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 画面へ戻す。結果は一言だけクエリに載せ、カルテ側で受け取って表示する。 */
function back(origin: string, result: string, extra?: string[]): Response {
  const url = new URL(origin);
  url.searchParams.set('strava', result);
  const headers = new Headers({ Location: url.toString(), 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', clearStateCookieHeader());
  for (const cookie of extra ?? []) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
}

/**
 * 認可から戻ってきたところ。
 * 鍵を受け取ってカルテに保存する。**鍵は画面へ返さない。**
 */
export async function GET(request: NextRequest) {
  const origin = siteOrigin(request);
  const url = new URL(request.url);

  if (!isStravaConfigured()) return back(origin, 'unconfigured');
  if (url.searchParams.get('error')) return back(origin, 'denied');

  const cookie = request.cookies.get(STRAVA_STATE_COOKIE)?.value;
  if (!stateMatches(cookie, url.searchParams.get('state'))) {
    return back(origin, 'state');
  }

  const code = url.searchParams.get('code');
  if (!code) return back(origin, 'denied');

  const session = await resolveUserId(request);
  const extra = session.isNew ? [userCookieHeader(session.userId)] : [];

  try {
    const tokens = await exchangeCode(code);
    const state = await loadForSession(session);
    const now = new Date();

    const profile = {
      ...state.profile,
      connections: {
        ...state.profile.connections,
        strava: {
          athleteId: tokens.athleteId,
          athleteName: tokens.athleteName,
          connectedAt: state.profile.connections?.strava?.connectedAt ?? now.toISOString(),
          // つなぎ直した時は、取り込み済みの件数を引き継ぐ。
          imported: state.profile.connections?.strava?.imported ?? 0,
          lastSyncedAt: state.profile.connections?.strava?.lastSyncedAt,
          secret: {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: tokens.expiresAt,
          },
        },
      },
      updatedAt: now.toISOString(),
    };

    await getStore().save(session.userId, { ...state, profile }, session.authUserId);
    return back(origin, 'connected', extra);
  } catch (error) {
    console.error('[coach] strava callback failed', error);
    if (error instanceof StravaError) console.error('[coach] strava detail', error.detail);
    return back(origin, 'failed', extra);
  }
}
