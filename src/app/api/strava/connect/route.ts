import type { NextRequest } from 'next/server';
import { resolveUserId, userCookieHeader } from '@/lib/session';
import { siteOrigin } from '@/lib/site-url';
import { newStateToken, stateCookieHeader } from '@/lib/strava-state';
import { authorizeUrl, isStravaConfigured } from '@/lib/strava';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Strava の認可画面へ送り出す。
 *
 * state を発行して Cookie にも同じ値を置く。
 * 戻ってきた時に突き合わせることで、他人が用意したリンクを
 * 踏まされて勝手につながるのを防ぐ。
 */
export async function GET(request: NextRequest) {
  if (!isStravaConfigured()) {
    return Response.json(
      { error: 'このアプリでは Strava 連携が設定されていません。' },
      { status: 503 },
    );
  }

  const session = await resolveUserId(request);
  const state = newStateToken();
  const headers = new Headers({ Location: authorizeUrl(siteOrigin(request), state) });
  headers.append('Set-Cookie', stateCookieHeader(state));
  if (session.isNew) headers.append('Set-Cookie', userCookieHeader(session.userId));

  // Cookie を確実に残すため、キャッシュさせない。
  headers.set('Cache-Control', 'no-store');
  return new Response(null, { status: 302, headers });
}
