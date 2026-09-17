import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoachState } from '@/lib/types';
import { createDefaultProfile } from '@/lib/types';
import { loadForSession, setStore, type CoachStore } from '@/lib/store';

/** メモリ上だけで動く保存層。引き継ぎの筋道だけを確かめる。 */
function memoryStore(initial: Record<string, CoachState> = {}) {
  const rows = new Map(Object.entries(initial));
  const store: CoachStore = {
    load: async (userId) => rows.get(userId) ?? { profile: createDefaultProfile(userId), history: [] },
    save: async (userId, state) => {
      rows.set(userId, state);
    },
    reset: async (userId) => {
      rows.delete(userId);
    },
    adopt: vi.fn(async (from, to) => {
      const source = rows.get(from);
      if (!source || rows.has(to)) return false;
      rows.set(to, { ...source, profile: { ...source.profile, id: to } });
      rows.delete(from);
      return true;
    }),
  };
  return { store, rows };
}

const withHistory = (userId: string): CoachState => ({
  profile: { ...createDefaultProfile(userId), displayName: 'ケント' },
  history: [{ role: 'user', parts: [{ text: 'やあ' }] }],
});

afterEach(() => setStore(null));

describe('loadForSession', () => {
  it('未ログインなら、引き継ぎを試みない', async () => {
    const { store } = memoryStore();
    setStore(store);

    await loadForSession({ userId: 'anon-1234', anonymousId: 'anon-1234' });
    expect(store.adopt).not.toHaveBeenCalled();
  });

  it('ログイン直後は、匿名の記録をアカウントへ引き継ぐ', async () => {
    const { store, rows } = memoryStore({ 'anon-1234': withHistory('anon-1234') });
    setStore(store);

    const state = await loadForSession({
      userId: 'auth-uuid',
      anonymousId: 'anon-1234',
      authUserId: 'auth-uuid',
    });

    expect(state.profile.displayName).toBe('ケント');
    expect(state.profile.id).toBe('auth-uuid');
    expect(rows.has('anon-1234')).toBe(false);
  });

  it('引き継ぎに失敗しても、対話は続けられる', async () => {
    // ここで例外を投げると、ログインした瞬間にアプリ全体が使えなくなる。
    const { store } = memoryStore();
    store.adopt = vi.fn(async () => {
      throw new Error('データベースに接続できません');
    });
    setStore(store);

    const state = await loadForSession({
      userId: 'auth-uuid',
      anonymousId: 'anon-1234',
      authUserId: 'auth-uuid',
    });

    expect(state.profile.id).toBe('auth-uuid');
  });

  it('匿名IDとログインIDが同じなら、何もしない', async () => {
    const { store } = memoryStore();
    setStore(store);

    await loadForSession({ userId: 'same-id', anonymousId: 'same-id', authUserId: 'same-id' });
    expect(store.adopt).not.toHaveBeenCalled();
  });
});
