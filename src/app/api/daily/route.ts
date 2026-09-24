import type { NextRequest } from 'next/server';
import { getStore, loadForSession } from '@/lib/store';
import { publicProfile } from '@/lib/profile';
import { resolveUserId, userCookieHeader } from '@/lib/session';
import { storageErrorResponse } from '@/lib/storage-error';
import { dailyStatus, logWeight, markOpened } from '@/lib/daily';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 今日の状態を返すだけ。 */
export async function GET(request: NextRequest) {
  const session = await resolveUserId(request);
  const { userId, isNew } = session;
  let state;
  try {
    state = await loadForSession(session);
  } catch (error) {
    return storageErrorResponse(error, '今日の記録を読み込めませんでした');
  }

  return Response.json(
    { daily: dailyStatus(state.profile) },
    { headers: isNew ? { 'Set-Cookie': userCookieHeader(userId) } : undefined },
  );
}

/** アプリを開いたことを記録する。画面のロード時に一度だけ呼ばれる。 */
export async function POST(request: NextRequest) {
  const session = await resolveUserId(request);
  const { userId, isNew } = session;
  const store = getStore();
  let profile;
  try {
    const state = await loadForSession(session);
    profile = markOpened(state.profile);
    if (profile !== state.profile) await store.save(userId, { ...state, profile }, session.authUserId);
  } catch (error) {
    return storageErrorResponse(error, 'スタンプを記録できませんでした');
  }

  return Response.json(
    { daily: dailyStatus(profile) },
    { headers: isNew ? { 'Set-Cookie': userCookieHeader(userId) } : undefined },
  );
}

/** 体重の記録。 */
export async function PATCH(request: NextRequest) {
  const session = await resolveUserId(request);
  const { userId } = session;
  const store = getStore();

  let body: { weightKg?: unknown };
  try {
    body = (await request.json()) as { weightKg?: unknown };
  } catch {
    return Response.json({ error: 'リクエストの形式が正しくありません。' }, { status: 400 });
  }

  const raw = typeof body.weightKg === 'string' ? Number(body.weightKg) : body.weightKg;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 20 || raw > 250) {
    return Response.json({ error: '体重は 20〜250kg の範囲で入力してください。' }, { status: 400 });
  }

  let profile;
  try {
    const state = await loadForSession(session);
    // 小数第1位まで。体重計の表示より細かく持っても意味がない。
    profile = logWeight(state.profile, Math.round(raw * 10) / 10);
    await store.save(userId, { ...state, profile }, session.authUserId);
  } catch (error) {
    return storageErrorResponse(error, '体重を記録できませんでした');
  }

  // 接続の鍵を含むので、必ず publicProfile を通す。
  return Response.json({ daily: dailyStatus(profile), profile: publicProfile(profile) });
}
