import type { NextRequest } from 'next/server';
import { getStore, loadForSession } from '@/lib/store';
import { resolveUserId } from '@/lib/session';
import { publicProfile } from '@/lib/profile';
import { storageErrorResponse } from '@/lib/storage-error';
import { deauthorize } from '@/lib/strava';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 接続を切る。
 *
 * 取り込んだ練習の記録は**消しません**。
 * 連携をやめたからといって、走った事実まで消える方がおかしい。
 * 消したい時は、カルテの「記録を消す」から本人が消せる。
 */
export async function POST(request: NextRequest) {
  const session = await resolveUserId(request);

  let state;
  try {
    state = await loadForSession(session);
  } catch (error) {
    return storageErrorResponse(error, 'カルテを読み込めませんでした');
  }

  const secret = state.profile.connections?.strava?.secret;
  if (secret) await deauthorize(secret.accessToken);

  const connections = { ...state.profile.connections };
  delete connections.strava;
  const profile = {
    ...state.profile,
    connections: Object.keys(connections).length > 0 ? connections : undefined,
    updatedAt: new Date().toISOString(),
  };

  try {
    await getStore().save(session.userId, { ...state, profile }, session.authUserId);
  } catch (error) {
    return storageErrorResponse(error, '接続を解除できませんでした');
  }

  return Response.json({ ok: true, profile: publicProfile(profile) });
}
