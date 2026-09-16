import type { NextRequest } from 'next/server';
import { getStore } from '@/lib/store';
import { resolveUserId, userCookieHeader } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** コーチが今なにを把握しているかを、いつでも本人が確認できるようにする。 */
export async function GET(request: NextRequest) {
  const { userId, isNew } = resolveUserId(request);
  const state = await getStore().load(userId);
  return Response.json(
    { profile: state.profile },
    { headers: isNew ? { 'Set-Cookie': userCookieHeader(userId) } : undefined },
  );
}

/** 記録を消す権利は本人にある。 */
export async function DELETE(request: NextRequest) {
  const { userId } = resolveUserId(request);
  await getStore().reset(userId);
  return Response.json({ ok: true });
}
