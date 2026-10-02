/**
 * 前回のカルテを、端末に控えておく。
 *
 * **開いた瞬間に今日やることが出る、という状態をつくるため。**
 *
 * いまは `/api/chat` の返事が来るまで、画面には
 * 「コーチを呼んでいます…」しか無い。走る前に地下鉄で開いた人、
 * 電波の弱い場所で開いた人、朝のモバイル回線が詰まっている人には、
 * **それが画面の全部**になる。帯に今日やることを置いた意味が消える。
 *
 * 控えておけば、通信を待たずに帯が出せる。圏外でも出る。
 *
 * ## やらないこと
 *
 * - **画面そのものをキャッシュしない。** サービスワーカーで HTML を抱えると、
 *   直したはずの不具合が直らない、という状態になる。これは public/sw.js の
 *   判断で、そこは変えない。ここで控えるのは**カルテの中身だけ**。
 * - **鍵を書かない。** 画面に来るのは publicProfile を通ったものだけだが、
 *   念のためここでも落とす。端末の localStorage は、他のアプリからは
 *   読めないが、端末を共有している人には読める場所。
 * - **古いものを使わない。** 1週間より古いカルテから予定を組むと、
 *   先週の走行距離で今日の量を決めることになる。
 */

import type { RunnerProfile } from './types';
import { publicProfile } from './profile';

const KEY = 'rc.last-seen.v1';
/** これより古い控えは使わない。 */
export const MAX_AGE_DAYS = 7;

const DAY_MS = 86_400_000;

interface Stored {
  at: string;
  profile: RunnerProfile;
}

/**
 * 控える。失敗しても黙って諦める（プライベートモード・容量いっぱい）。
 *
 * **落とす規則は publicProfile に任せる。**
 * ここで同じことを書き直すと、守るものが増えた時に片方だけ直って、
 * もう片方から漏れる。画面に来るのはすでに通ったものだが、
 * もう一度通しても同じ結果になるだけで、害は無い。
 */
export function saveLastSeen(profile: RunnerProfile, now: Date = new Date()): void {
  try {
    const stored: Stored = { at: now.toISOString(), profile: publicProfile(profile) };
    window.localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // 控えられないことは、致命的ではない。これまでと同じ動きに戻るだけ。
  }
}

/** 控えを読む。無い・古い・壊れている時は null。 */
export function readLastSeen(now: Date = new Date()): RunnerProfile | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;

    const stored = JSON.parse(raw) as Stored | null;
    if (!stored?.profile || typeof stored.at !== 'string') return null;

    const at = Date.parse(stored.at);
    if (Number.isNaN(at)) return null;
    // **古い控えから予定を組まない。** 先週の量で今日を決めることになる。
    if (now.getTime() - at > MAX_AGE_DAYS * DAY_MS) return null;

    // 形だけ確かめる。これが無いと、todayPlan の中で落ちる。
    if (!Array.isArray(stored.profile.activities)) return null;

    return stored.profile;
  } catch {
    return null;
  }
}

/**
 * 控えを消す。
 * **カルテを消した時と、ログアウトした時に必ず呼ぶ。**
 * 消したはずの記録が、次に開いた時に出てくるのが最悪。
 */
export function clearLastSeen(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // 消せない時にできることは無い。
  }
}
