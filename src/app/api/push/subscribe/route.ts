import type { NextRequest } from 'next/server';
import { getStore, loadForSession } from '@/lib/store';
import { resolveUserId, userCookieHeader } from '@/lib/session';
import { storageErrorResponse } from '@/lib/storage-error';
import { addSubscription, isPushConfigured, removeSubscription } from '@/lib/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
}

/** 通知の宛先を預かる。端末ごとに1つ。 */
export async function POST(request: NextRequest) {
  if (!isPushConfigured()) {
    return Response.json({ error: 'このアプリでは通知が設定されていません。' }, { status: 503 });
  }

  const session = await resolveUserId(request);
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: 'リクエストの形式が正しくありません。' }, { status: 400 });
  }

  const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
  const p256dh = typeof body.keys?.p256dh === 'string' ? body.keys.p256dh : '';
  const auth = typeof body.keys?.auth === 'string' ? body.keys.auth : '';
  if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) {
    return Response.json({ error: '通知の宛先を受け取れませんでした。' }, { status: 400 });
  }

  let state;
  try {
    state = await loadForSession(session);
  } catch (error) {
    return storageErrorResponse(error, 'カルテを読み込めませんでした');
  }

  const profile = addSubscription(state.profile, { endpoint, keys: { p256dh, auth } });
  try {
    await getStore().save(session.userId, { ...state, profile }, session.authUserId);
  } catch (error) {
    return storageErrorResponse(error, '通知の設定を保存できませんでした');
  }

  return Response.json(
    { ok: true },
    { headers: session.isNew ? { 'Set-Cookie': userCookieHeader(session.userId) } : undefined },
  );
}

/** 通知を止める。宛先は残さない。 */
export async function DELETE(request: NextRequest) {
  const session = await resolveUserId(request);
  let endpoint = '';
  try {
    const body = (await request.json()) as Body;
    endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
  } catch {
    // 宛先が分からない時は、この端末ぶんを消せないので何もしない。
  }

  let state;
  try {
    state = await loadForSession(session);
  } catch (error) {
    return storageErrorResponse(error, 'カルテを読み込めませんでした');
  }

  const profile = endpoint
    ? removeSubscription(state.profile, endpoint)
    : { ...state.profile, pushSubscriptions: [] };

  try {
    await getStore().save(session.userId, { ...state, profile }, session.authUserId);
  } catch (error) {
    return storageErrorResponse(error, '通知の設定を保存できませんでした');
  }
  return Response.json({ ok: true });
}
