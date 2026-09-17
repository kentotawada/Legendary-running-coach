import type { NextRequest } from 'next/server';
import { getStore } from '@/lib/store';
import { resolveUserId, userCookieHeader } from '@/lib/session';
import { dailyStatus, logWeight, markOpened } from '@/lib/daily';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 今日の状態を返すだけ。 */
export async function GET(request: NextRequest) {
  const { userId, isNew } = resolveUserId(request);
  const state = await getStore().load(userId);
  return Response.json(
    { daily: dailyStatus(state.profile) },
    { headers: isNew ? { 'Set-Cookie': userCookieHeader(userId) } : undefined },
  );
}

/** アプリを開いたことを記録する。画面のロード時に一度だけ呼ばれる。 */
export async function POST(request: NextRequest) {
  const { userId, isNew } = resolveUserId(request);
  const store = getStore();
  const state = await store.load(userId);
  const profile = markOpened(state.profile);

  if (profile !== state.profile) await store.save(userId, { ...state, profile });

  return Response.json(
    { daily: dailyStatus(profile) },
    { headers: isNew ? { 'Set-Cookie': userCookieHeader(userId) } : undefined },
  );
}

/** 体重の記録。 */
export async function PATCH(request: NextRequest) {
  const { userId } = resolveUserId(request);
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

  const state = await store.load(userId);
  // 小数第1位まで。体重計の表示より細かく持っても意味がない。
  const profile = logWeight(state.profile, Math.round(raw * 10) / 10);
  await store.save(userId, { ...state, profile });

  return Response.json({ daily: dailyStatus(profile), profile });
}
