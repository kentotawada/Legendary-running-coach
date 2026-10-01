import type { NextRequest } from 'next/server';
import { CONSENT_REQUIRED_MESSAGE, hasConsent } from '@/lib/legal';
import { getStore, loadForSession } from '@/lib/store';
import { publicProfile } from '@/lib/profile';
import { resolveUserId, userCookieHeader } from '@/lib/session';
import { storageErrorResponse } from '@/lib/storage-error';
import { dailyStatus, logWeight, markOpened, addIntake} from '@/lib/daily';
import { isBodyFatInRange } from '@/lib/composition';

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

  // **カルテも返す。** 画面はここからスタンプを組み立てるので、
  // 「開いた」印がカルテに入っていないと、その場で消えてしまう。
  return Response.json(
    { daily: dailyStatus(profile), profile: publicProfile(profile) },
    { headers: isNew ? { 'Set-Cookie': userCookieHeader(userId) } : undefined },
  );
}

/** 体重の記録。 */
export async function PATCH(request: NextRequest) {
  const session = await resolveUserId(request);
  const { userId } = session;
  const store = getStore();

  let body: { weightKg?: unknown; bodyFatPercent?: unknown; addIntakeKcal?: unknown };
  try {
    body = (await request.json()) as {
      weightKg?: unknown;
      bodyFatPercent?: unknown;
      addIntakeKcal?: unknown;
    };
  } catch {
    return Response.json({ error: 'リクエストの形式が正しくありません。' }, { status: 400 });
  }

  /*
    **食べた量を足すだけの呼び出し。** 体重とは別の道にする。
    一緒にすると、体重を入れないと食事を記録できない形になってしまう。
  */
  const addRaw =
    typeof body.addIntakeKcal === 'string' ? Number(body.addIntakeKcal) : body.addIntakeKcal;
  if (addRaw !== undefined && addRaw !== null) {
    if (typeof addRaw !== 'number' || !Number.isFinite(addRaw) || addRaw <= 0 || addRaw > 5000) {
      return Response.json({ error: '食べた量は 1〜5000kcal の範囲で入力してください。' }, { status: 400 });
    }
    try {
      const state = await loadForSession(session);
      if (!hasConsent(state.profile)) {
        return Response.json({ error: CONSENT_REQUIRED_MESSAGE }, { status: 403 });
      }
      const next = addIntake(state.profile, Math.round(addRaw));
      await store.save(userId, { ...state, profile: next }, session.authUserId);
      return Response.json({ daily: dailyStatus(next), profile: publicProfile(next) });
    } catch (error) {
      return storageErrorResponse(error, '食べた量を記録できませんでした');
    }
  }

  const raw = typeof body.weightKg === 'string' ? Number(body.weightKg) : body.weightKg;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 20 || raw > 250) {
    return Response.json({ error: '体重は 20〜250kg の範囲で入力してください。' }, { status: 400 });
  }

  /*
    体脂肪率は、体組成計を持っている人だけが入れるので、**無くても通す。**
    入っていて範囲の外なら、黙って捨てずに断る（打ち間違いを記録しない）。
  */
  const fatRaw =
    typeof body.bodyFatPercent === 'string' ? Number(body.bodyFatPercent) : body.bodyFatPercent;
  let bodyFatPercent: number | undefined;
  if (fatRaw !== undefined && fatRaw !== null && fatRaw !== '') {
    if (typeof fatRaw !== 'number' || !isBodyFatInRange(fatRaw)) {
      return Response.json({ error: '体脂肪率は 3〜60% の範囲で入力してください。' }, { status: 400 });
    }
    bodyFatPercent = Math.round(fatRaw * 10) / 10;
  }


  let profile;
  try {
    const state = await loadForSession(session);
    // 体重は体の情報。預かる前に同意を確かめる。
    if (!hasConsent(state.profile)) {
      return Response.json({ error: CONSENT_REQUIRED_MESSAGE }, { status: 403 });
    }
    // 小数第1位まで。体重計の表示より細かく持っても意味がない。
    profile = logWeight(state.profile, Math.round(raw * 10) / 10, undefined, undefined, bodyFatPercent);
    await store.save(userId, { ...state, profile }, session.authUserId);
  } catch (error) {
    return storageErrorResponse(error, '体重を記録できませんでした');
  }

  // 接続の鍵を含むので、必ず publicProfile を通す。
  return Response.json({ daily: dailyStatus(profile), profile: publicProfile(profile) });
}
