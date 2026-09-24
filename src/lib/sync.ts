/**
 * Strava からの取り込み。
 *
 * ここが「スクリーンショットを撮って送る」を消す層です。
 * 走り終えて家に着いた頃には、もう記録が入っていて、開けば評価がある。
 *
 * 取り込みで気をつけていること:
 *  - **二重に入れない。** 同じ練習が2つ並ぶと、週の走行距離がまるごと狂う。
 *  - **靴の距離は向こうが正。** Strava で管理している靴に、こちらで足さない。
 *  - 取り込みに失敗しても、それまでに入った分は残す。全部やり直しにしない。
 */

import type { ActivityLog, RunnerProfile } from './types';
import { addActivity, addShoeDistance, upsertExternalShoe } from './profile';
import { attributeRun } from './shoes';
import {
  FIRST_SYNC_DAYS,
  StravaError,
  fetchActivities,
  fetchGear,
  needsRefresh,
  refreshTokens,
  shoeRoleOf,
  toActivityLog,
  type StravaActivity,
} from './strava';

/** 前回の同期の直前まで少し遡る。境目の1本を取りこぼさないため。 */
const OVERLAP_SEC = 3600;

export interface SyncOptions {
  now?: Date;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

export interface SyncResult {
  profile: RunnerProfile;
  /** 新しく取り込んだ練習の数。 */
  imported: number;
  /** すでに持っていて飛ばした数。 */
  skipped: number;
  /** 取り込んだ / 更新した靴の数。 */
  shoes: number;
  firstTime: boolean;
}

function epoch(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const value = Date.parse(iso);
  return Number.isNaN(value) ? undefined : Math.floor(value / 1000);
}

/**
 * Strava の記録をカルテへ取り込む。
 * つながっていない時は例外。呼び出し側が「まずつないでください」と言えるようにする。
 */
export async function syncStrava(
  profile: RunnerProfile,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const { now = new Date(), env = process.env, fetchImpl } = options;
  const connection = profile.connections?.strava;
  const secret = connection?.secret;
  if (!connection || !secret) {
    throw new StravaError('Strava につながっていません。', 'no connection');
  }

  let next = profile;
  let accessToken = secret.accessToken;

  // 期限が切れていれば、先に更新する。切れたまま叩くと 401 になるだけ。
  if (needsRefresh(secret.expiresAt, now)) {
    const refreshed = await refreshTokens(secret.refreshToken, env, fetchImpl);
    accessToken = refreshed.accessToken;
    next = {
      ...next,
      connections: {
        ...next.connections,
        strava: {
          ...connection,
          secret: {
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            expiresAt: refreshed.expiresAt,
          },
        },
      },
    };
  }

  const lastSynced = epoch(connection.lastSyncedAt);
  const firstTime = lastSynced === undefined;
  const after = firstTime
    ? Math.floor(now.getTime() / 1000) - FIRST_SYNC_DAYS * 86_400
    : lastSynced - OVERLAP_SEC;

  const activities = await fetchActivities(accessToken, after, fetchImpl);

  // 先に靴を揃える。練習に「どの靴で走ったか」を書き込むために、先へ回す。
  const gearIds = [
    ...new Set(
      activities
        .map((activity) => activity.gear_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];
  const shoeByGear = new Map<string, string>();
  let shoes = 0;
  for (const gearId of gearIds) {
    const gear = await fetchGear(accessToken, gearId, fetchImpl);
    if (!gear?.name) continue;
    next = upsertExternalShoe(
      next,
      {
        externalId: `strava:${gearId}`,
        name: gear.name,
        km: (gear.distance ?? 0) / 1000,
        role: shoeRoleOf(gear.name),
        retired: gear.retired,
      },
      now,
    );
    const stored = next.shoes?.find((shoe) => shoe.externalId === `strava:${gearId}`);
    if (stored) {
      shoeByGear.set(gearId, stored.id);
      shoes += 1;
    }
  }

  const known = new Set(
    next.activities.map((activity) => activity.externalId).filter((id): id is string => Boolean(id)),
  );

  let imported = 0;
  let skipped = 0;
  for (const activity of activities) {
    const mapped = toActivityLog(activity);
    if (!mapped) continue;
    if (mapped.externalId && known.has(mapped.externalId)) {
      skipped += 1;
      continue;
    }

    const shoeId = typeof activity.gear_id === 'string' ? shoeByGear.get(activity.gear_id) : undefined;
    const entry: Omit<ActivityLog, 'id' | 'createdAt'> = shoeId ? { ...mapped, shoeId } : mapped;
    next = addActivity(next, entry, now);
    if (mapped.externalId) known.add(mapped.externalId);
    imported += 1;

    // Strava で靴を管理していない人のために、こちらの靴へ積む道も残しておく。
    // 1足しか無い時だけ。2足以上あって分からない時に当てずっぽうで積まない。
    if (!shoeId && mapped.type === 'run' && mapped.distanceKm) {
      const guess = attributeRun(next, undefined);
      if (guess && !guess.externalId) next = addShoeDistance(next, guess.id, mapped.distanceKm, now);
    }
  }

  const strava = next.connections?.strava;
  return {
    profile: {
      ...next,
      connections: {
        ...next.connections,
        strava: {
          ...(strava ?? connection),
          lastSyncedAt: now.toISOString(),
          imported: (connection.imported ?? 0) + imported,
        },
      },
      updatedAt: now.toISOString(),
    },
    imported,
    skipped,
    shoes,
    firstTime,
  };
}

/** 取り込んだ結果を、そのまま画面に出せる一文にする。 */
export function describeSync(result: SyncResult): string {
  if (result.imported === 0) {
    return result.skipped > 0 ? '新しい練習はありませんでした。' : '取り込む練習がありませんでした。';
  }
  const parts = [`${result.imported}件の練習を取り込みました`];
  if (result.shoes > 0) parts.push(`シューズ${result.shoes}足の走行距離も更新しました`);
  return `${parts.join('。')}。`;
}

/**
 * プロンプトに差し込む、連携の状態。
 *
 * つながっているのにスクリーンショットを求めるのは、
 * 「自分の言ったことを聞いていない」の典型なので、ここで止める。
 */
export function connectionDoctrine(
  profile: RunnerProfile,
  available: boolean,
  now: Date = new Date(),
): string | null {
  const strava = profile.connections?.strava;

  if (strava) {
    const lines = [
      '# ランニングアプリとの連携',
      '- **Strava とつながっている。練習は自動で入る。**',
      '  「スクリーンショットを送ってください」と求めないこと。すでに手元にある。',
      '- 「直近の行動」に (Stravaから自動取込) と付いているものが、それ。',
      '  数値は時計が測ったものなので、読み取り誤りを疑う必要はない。',
      '- ただし**主観**は入ってこない。どう感じたか、脚がどうだったかは、こちらから尋ねる価値がある。',
    ];
    if (!strava.lastSyncedAt) {
      lines.push('- まだ一度も取り込めていない。次に開いた時に入る見込み。急かさないこと。');
    }
    return lines.join('\n');
  }

  if (!available) return null;

  // 画像から記録した回数。何度も撮らせているなら、一度だけ案内する価値がある。
  const fromImages = profile.activities.filter(
    (activity) =>
      activity.source === 'screenshot' &&
      Date.parse(activity.createdAt) > now.getTime() - 30 * 86_400_000,
  ).length;
  if (fromImages < 2) return null;

  return [
    '# ランニングアプリとの連携（未接続）',
    `- 直近30日で${fromImages}回、スクリーンショットから記録している。`,
    '- カルテから Strava をつなぐと、**走り終えた時点で記録が入る**ようになる。',
    '  ガーミンの時計も、Strava へ自動連携していればそのまま入る。',
    '- **案内は一度だけ。** 毎回勧めるのは、ただのしつこい宣伝になる。',
  ].join('\n');
}
