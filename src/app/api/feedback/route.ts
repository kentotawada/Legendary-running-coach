import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { findCharacter } from '@/lib/characters';
import { coachDate } from '@/lib/day';
import { counterOf, getOps } from '@/lib/ops';
import { clientAddress, placeId, planFor } from '@/lib/quota';
import { resolveUserId } from '@/lib/session';
import { getStore, loadForSession } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 1人が1日に送れる評価の数。ふつうに使って届かない数で、連打だけを止める。 */
const PER_USER = 200;
/** 同じ回線から1日に受け付ける数。Cookie を消して別人として来る連打を止める。 */
const PER_PLACE = 400;

/** 理由として受け付ける長さ。 */
const MAX_REASON = 300;

/**
 * 返答への「良い・良くない」を受け取り、持ち主が /admin で読めるところに残す。
 *
 * **これまで、押しても端末の中で消えていた。** どの返答が外したのかを知る手段が無かった。
 * 「良くない」とその理由は、コーチを良くするいちばんの材料になる。
 *
 * 残すのは、評価・理由・**評価した返答の文面**・コーチ。利用者が書いた文章は残さない
 * （プライバシーポリシーに書いた範囲）。
 */
export async function POST(request: NextRequest) {
  let body: { rating?: unknown; reason?: unknown; reply?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'リクエストの形式が正しくありません。' }, { status: 400 });
  }

  const rating = body.rating === 'good' || body.rating === 'bad' ? body.rating : null;
  const reply = typeof body.reply === 'string' ? body.reply.trim() : '';
  if (!rating || !reply) {
    return Response.json({ error: '評価を受け取れませんでした。' }, { status: 400 });
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, MAX_REASON) : '';

  const session = await resolveUserId(request);

  // 連打だけを止める。数えられない時は、受け付ける側に倒す（評価は無くても困らないが、あって困るものでもない）。
  const counter = counterOf(getStore());
  if (counter) {
    const day = coachDate();
    const address = clientAddress(request.headers);
    try {
      const [mine, place] = await Promise.all([
        counter.bumpUsage(`feedback:${day}:user:${session.userId}`),
        address ? counter.bumpUsage(`feedback:${day}:place:${placeId(address, day)}`) : Promise.resolve(0),
      ]);
      if (mine > PER_USER || place > PER_PLACE) return new Response(null, { status: 204 });
    } catch {
      // 数え損ねても、評価は受け取る。
    }
  }

  let characterId: string | undefined;
  try {
    characterId = (await loadForSession(session)).profile.characterId;
  } catch {
    // コーチが分からなくても、評価そのものは残す。
  }

  /**
   * 同じ人が同じ返答を評価し直したら、1件のまま書き換える。
   * **返答の位置（何通目か）ではなく、文面で見分ける。** 古い会話が詰められると、
   * 位置は別の返答を指すようになるため。
   */
  const ref = `${session.userId}:${createHash('sha256').update(reply).digest('hex').slice(0, 24)}`;

  try {
    await getOps().record('feedback', {
      userId: session.userId,
      ref,
      payload: {
        rating,
        reason: reason || undefined,
        reply,
        coach: characterId ? findCharacter(characterId).name : undefined,
        plan: planFor(session),
      },
    });
  } catch (error) {
    console.error('[feedback] 評価を記録できませんでした', error);
    return Response.json({ error: '評価を送れませんでした。' }, { status: 503 });
  }

  return Response.json({ ok: true });
}
