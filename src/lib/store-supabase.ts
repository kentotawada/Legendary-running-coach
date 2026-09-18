import type { SupabaseClient } from '@supabase/supabase-js';
import type { CoachState } from './types';
import { createDefaultProfile } from './types';
import type { CoachStore } from './store';
import { storageError } from './storage-error';

/** Supabase に置く1行ぶんの形。 */
interface CoachStateRow {
  user_id: string;
  auth_user_id: string | null;
  profile: unknown;
  history: unknown;
}

const TABLE = 'coach_states';

/**
 * Supabase（PostgREST）に保存する実装。
 *
 * サーバーレスでも接続プールを気にせずに済むよう、直接の Postgres 接続ではなく
 * HTTP 経由の PostgREST を使っている。
 */
export class SupabaseCoachStore implements CoachStore {
  constructor(private readonly client: SupabaseClient) {}

  async load(userId: string): Promise<CoachState> {
    const { data, error } = await this.client
      .from(TABLE)
      .select('user_id, auth_user_id, profile, history')
      .eq('user_id', userId)
      .maybeSingle<CoachStateRow>();

    if (error) throw storageError('カルテの読み込み', error.code, error.message);
    if (!data) return { profile: createDefaultProfile(userId), history: [] };

    return {
      // 保存済みの値を優先しつつ、新しく増えた項目は既定値で埋める。
      profile: { ...createDefaultProfile(userId), ...(data.profile as object), id: userId },
      history: Array.isArray(data.history) ? (data.history as CoachState['history']) : [],
    };
  }

  async save(userId: string, state: CoachState, authUserId?: string): Promise<void> {
    const { error } = await this.client.from(TABLE).upsert(
      {
        user_id: userId,
        auth_user_id: authUserId ?? null,
        profile: state.profile,
        history: state.history,
      },
      { onConflict: 'user_id' },
    );

    if (error) throw storageError('カルテの保存', error.code, error.message);
  }

  async reset(userId: string): Promise<void> {
    const { error } = await this.client.from(TABLE).delete().eq('user_id', userId);
    if (error) throw storageError('記録の消去', error.code, error.message);
  }

  /**
   * 未ログインで貯めた記録を、ログイン後のアカウントへ引き継ぐ。
   * すでにアカウント側に記録があれば、上書きせず何もしない。
   */
  async adopt(fromUserId: string, toUserId: string, authUserId?: string): Promise<boolean> {
    if (fromUserId === toUserId) return false;

    const { data: source, error: sourceError } = await this.client
      .from(TABLE)
      .select('user_id, auth_user_id, profile, history')
      .eq('user_id', fromUserId)
      .maybeSingle<CoachStateRow>();

    if (sourceError) throw storageError('引き継ぎ元の読み込み', sourceError.code, sourceError.message);
    if (!source) return false;

    const { data: target, error: targetError } = await this.client
      .from(TABLE)
      .select('user_id')
      .eq('user_id', toUserId)
      .maybeSingle<{ user_id: string }>();

    if (targetError) throw storageError('引き継ぎ先の読み込み', targetError.code, targetError.message);
    if (target) {
      // すでにアカウント側に記録がある。匿名の記録で上書きしてはいけない。
      return false;
    }

    const profile = { ...(source.profile as object), id: toUserId };
    const { error: insertError } = await this.client.from(TABLE).insert({
      user_id: toUserId,
      auth_user_id: authUserId ?? null,
      profile,
      history: source.history,
    });
    if (insertError) throw storageError('記録の引き継ぎ', insertError.code, insertError.message);

    await this.client.from(TABLE).delete().eq('user_id', fromUserId);
    return true;
  }
}
