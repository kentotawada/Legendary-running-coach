/**
 * 運営のための記録。持ち主だけが見る（/admin）。
 *
 * **このアプリを事業として回すには、見えていないといけないものがある。**
 *  - 何人来て、何人が使い始めたか
 *  - どこで壊れているか（昨日、本番が古いまま丸一日止まっていたのに誰も気づけなかった）
 *  - 返答のどれが外したか（「良くない」を押した理由）
 *  - 無料の上限に何人が当たったか（＝お金を払ってでも使いたい人の数）
 *
 * 回数は usage_counters（quota.ts と同じ表）、文章を伴うもの（不具合・評価）は
 * app_events に置く。どちらも利用者の側からは読めない。
 */

import { coachDate } from './day';
import { createSupabaseAdminClient } from './supabase';
import { sharedDevUsage, type UsageCounter } from './quota';

export type EventKind = 'error' | 'feedback';

export interface OpsEvent {
  at: string;
  userId?: string;
  payload: Record<string, unknown>;
}

export interface OpsLog {
  /** 文章を伴う記録を1件残す。 */
  record(kind: EventKind, entry: { userId?: string; payload: Record<string, unknown> }): Promise<void>;
  /** 新しい順に読む。 */
  recent(kind: EventKind, limit: number): Promise<OpsEvent[]>;
  /** 回数をまとめて読む。無い鍵は 0。 */
  counts(keys: string[]): Promise<Record<string, number>>;
}

/** 1件に残す長さの上限。**スタックトレースを丸ごと貯めない。** */
const MAX_TEXT = 2000;

/** 文字列は長さを切り、入れ子は浅く保つ。何が来ても表が膨れないように。 */
export function clip(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload).slice(0, 20)) {
    if (typeof value === 'string') out[key] = value.slice(0, MAX_TEXT);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) out[key] = value;
    else if (value !== undefined) out[key] = JSON.stringify(value).slice(0, MAX_TEXT);
  }
  return out;
}

class SupabaseOpsLog implements OpsLog {
  constructor(private readonly client: NonNullable<ReturnType<typeof createSupabaseAdminClient>>) {}

  async record(kind: EventKind, entry: { userId?: string; payload: Record<string, unknown> }) {
    const { error } = await this.client
      .from('app_events')
      .insert({ kind, user_id: entry.userId ?? null, payload: clip(entry.payload) });
    if (error) throw new Error(`${error.code ?? ''} ${error.message}`);
  }

  async recent(kind: EventKind, limit: number): Promise<OpsEvent[]> {
    const { data, error } = await this.client
      .from('app_events')
      .select('created_at, user_id, payload')
      .eq('kind', kind)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`${error.code ?? ''} ${error.message}`);
    return (data ?? []).map((row) => ({
      at: row.created_at as string,
      userId: (row.user_id as string | null) ?? undefined,
      payload: (row.payload ?? {}) as Record<string, unknown>,
    }));
  }

  async counts(keys: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = Object.fromEntries(keys.map((key) => [key, 0]));
    // 一度に投げる鍵の数を抑える（URL が長くなりすぎないように）。
    for (let i = 0; i < keys.length; i += 100) {
      const { data, error } = await this.client
        .from('usage_counters')
        .select('key, count')
        .in('key', keys.slice(i, i + 100));
      if (error) throw new Error(`${error.code ?? ''} ${error.message}`);
      for (const row of data ?? []) out[row.key as string] = Number(row.count);
    }
    return out;
  }
}

/** データベースが無い時（手元の開発・テスト）。プロセスが生きている間だけ覚えている。 */
export class MemoryOpsLog implements OpsLog {
  private readonly events: { kind: EventKind; event: OpsEvent }[] = [];
  constructor(private readonly counter?: UsageCounter & { peek?: (key: string) => number }) {}

  async record(kind: EventKind, entry: { userId?: string; payload: Record<string, unknown> }) {
    this.events.push({ kind, event: { at: new Date().toISOString(), userId: entry.userId, payload: clip(entry.payload) } });
  }

  async recent(kind: EventKind, limit: number): Promise<OpsEvent[]> {
    return this.events
      .filter((item) => item.kind === kind)
      .map((item) => item.event)
      .reverse()
      .slice(0, limit);
  }

  async counts(keys: string[]): Promise<Record<string, number>> {
    return Object.fromEntries(keys.map((key) => [key, this.counter?.peek?.(key) ?? 0]));
  }
}

let ops: OpsLog | null = null;

export function getOps(): OpsLog {
  if (ops) return ops;
  const client = createSupabaseAdminClient();
  if (client) {
    ops = new SupabaseOpsLog(client);
  } else {
    // 手元の開発。API とページは別々に組み立てられるので、プロセスで1つだけ置いて共有する。
    const holder = globalThis as { __runcoachOps?: MemoryOpsLog };
    holder.__runcoachOps ??= new MemoryOpsLog(sharedDevUsage());
    ops = holder.__runcoachOps;
  }
  return ops;
}

/** テスト用。 */
export function setOps(custom: OpsLog | null): void {
  ops = custom;
}

/**
 * 不具合を残す。**残すことに失敗しても、元の処理は止めない。**
 * 記録のための記録で、利用者の画面を壊しては本末転倒。
 */
export async function reportError(
  where: string,
  error: unknown,
  extra: { userId?: string } & Record<string, unknown> = {},
): Promise<void> {
  const { userId, ...rest } = extra;
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  try {
    await getOps().record('error', {
      userId,
      payload: {
        where,
        message,
        stack: error instanceof Error ? error.stack?.split('\n').slice(0, 8).join('\n') : undefined,
        build: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
        ...rest,
      },
    });
  } catch (failure) {
    console.error('[ops] 不具合を記録できませんでした', failure);
  }
}

/**
 * 利用の流れのうち、事業として見たい出来事を1つ数える。
 *   signup   コーチを選んで使い始めた
 *   consent  規約に同意した
 *   import   記録を取り込んだ
 *   push_on  通知を受け取る設定にした
 *   limit:*  1日の上限に当たった（理由と枠ごと）
 */
export async function countEvent(
  counter: UsageCounter | undefined,
  name: string,
  by = 1,
  now: Date = new Date(),
): Promise<void> {
  if (!counter || by <= 0) return;
  try {
    await counter.bumpUsage(`event:${coachDate(now)}:${name}`, by);
  } catch {
    // 集計の欠けで、利用者の操作を失敗させない。
  }
}

/** 数え先を持つ保存層から、数える口だけを取り出す。 */
export function counterOf(store: { bumpUsage?: (key: string, by?: number) => Promise<number> }): UsageCounter | undefined {
  return store.bumpUsage ? { bumpUsage: store.bumpUsage.bind(store) } : undefined;
}
