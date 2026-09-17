import { beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseCoachStore } from '@/lib/store-supabase';
import { supabaseConfig, isSupabaseConfigured } from '@/lib/supabase';
import { createDefaultProfile } from '@/lib/types';

/**
 * Supabase の代わりに、同じ呼び出し方ができる最小限の偽物を用意する。
 * PostgREST の実物は用意できないので、ここで検証するのは
 * 「どう呼んでいるか」と「返ってきた値をどう扱うか」。
 */
interface Row {
  user_id: string;
  auth_user_id: string | null;
  profile: unknown;
  history: unknown;
}

function fakeSupabase(rows: Row[] = []) {
  const table = new Map(rows.map((row) => [row.user_id, row]));
  const calls: string[] = [];

  const client = {
    from(name: string) {
      calls.push(`from:${name}`);
      let filterKey = '';
      let filterValue = '';
      const builder = {
        select() {
          return builder;
        },
        eq(key: string, value: string) {
          filterKey = key;
          filterValue = value;
          return builder;
        },
        maybeSingle() {
          calls.push(`select:${filterValue}`);
          const found = filterKey === 'user_id' ? table.get(filterValue) : undefined;
          return Promise.resolve({ data: found ?? null, error: null });
        },
        upsert(row: Row) {
          calls.push(`upsert:${row.user_id}`);
          table.set(row.user_id, row);
          return Promise.resolve({ error: null });
        },
        insert(row: Row) {
          calls.push(`insert:${row.user_id}`);
          table.set(row.user_id, row);
          return Promise.resolve({ error: null });
        },
        delete() {
          return {
            eq(_key: string, value: string) {
              calls.push(`delete:${value}`);
              table.delete(value);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
      return builder;
    },
  };

  return { client: client as unknown as SupabaseClient, table, calls };
}

const row = (userId: string, overrides: Partial<Row> = {}): Row => ({
  user_id: userId,
  auth_user_id: null,
  profile: { ...createDefaultProfile(userId), displayName: 'ケント' },
  history: [{ role: 'user', parts: [{ text: 'やあ' }] }],
  ...overrides,
});

describe('SupabaseCoachStore', () => {
  it('行が無ければ、まっさらなカルテを返す', async () => {
    const { client } = fakeSupabase();
    const state = await new SupabaseCoachStore(client).load('anon-1234');

    expect(state.profile.id).toBe('anon-1234');
    expect(state.history).toEqual([]);
  });

  it('保存済みの値を読み、増えた項目は既定値で埋める', async () => {
    const { client } = fakeSupabase([row('anon-1234', { profile: { displayName: 'ケント' } })]);
    const state = await new SupabaseCoachStore(client).load('anon-1234');

    expect(state.profile.displayName).toBe('ケント');
    // 後から足した項目も、読み込み時に既定値が入る。
    expect(state.profile.pains).toEqual([]);
    expect(state.profile.id).toBe('anon-1234');
  });

  it('ログイン済みなら、持ち主を行に記録する', async () => {
    const { client, table } = fakeSupabase();
    await new SupabaseCoachStore(client).save(
      'auth-uuid',
      { profile: createDefaultProfile('auth-uuid'), history: [] },
      'auth-uuid',
    );

    expect(table.get('auth-uuid')?.auth_user_id).toBe('auth-uuid');
  });

  it('未ログインなら、持ち主は空のまま', async () => {
    const { client, table } = fakeSupabase();
    await new SupabaseCoachStore(client).save('anon-1234', {
      profile: createDefaultProfile('anon-1234'),
      history: [],
    });

    expect(table.get('anon-1234')?.auth_user_id).toBeNull();
  });

  it('読み書きの失敗は、理由の分かる形で投げる', async () => {
    const failing = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: '接続できません' } }) }) }),
      }),
    } as unknown as SupabaseClient;

    await expect(new SupabaseCoachStore(failing).load('anon-1234')).rejects.toThrow(/接続できません/);
  });
});

describe('未ログインの記録の引き継ぎ', () => {
  it('ログイン後のアカウントへ引き継ぎ、匿名の行は消す', async () => {
    const { client, table } = fakeSupabase([row('anon-1234')]);
    const adopted = await new SupabaseCoachStore(client).adopt('anon-1234', 'auth-uuid', 'auth-uuid');

    expect(adopted).toBe(true);
    expect(table.has('anon-1234')).toBe(false);
    expect(table.get('auth-uuid')?.auth_user_id).toBe('auth-uuid');
    expect((table.get('auth-uuid')?.profile as { id: string }).id).toBe('auth-uuid');
  });

  it('アカウント側にすでに記録があれば、上書きしない', async () => {
    // ここを誤ると、別端末で積み上げたカルテが匿名の記録で消える。
    const { client, table } = fakeSupabase([
      row('anon-1234'),
      row('auth-uuid', { profile: { displayName: '本来の記録' } }),
    ]);
    const adopted = await new SupabaseCoachStore(client).adopt('anon-1234', 'auth-uuid', 'auth-uuid');

    expect(adopted).toBe(false);
    expect((table.get('auth-uuid')?.profile as { displayName: string }).displayName).toBe('本来の記録');
    expect(table.has('anon-1234')).toBe(true);
  });

  it('引き継ぐ記録が無ければ何もしない', async () => {
    const { client, calls } = fakeSupabase();
    expect(await new SupabaseCoachStore(client).adopt('anon-1234', 'auth-uuid')).toBe(false);
    expect(calls.some((c) => c.startsWith('insert'))).toBe(false);
  });

  it('同じIDなら何もしない', async () => {
    const { client } = fakeSupabase([row('same-id-1234')]);
    expect(await new SupabaseCoachStore(client).adopt('same-id-1234', 'same-id-1234')).toBe(false);
  });
});

describe('設定の読み取り', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env = { ...saved };
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  });

  it('未設定なら null を返す（ログイン機能を出さない）', () => {
    expect(supabaseConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(isSupabaseConfigured({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it('新旧どちらのキー名でも受け取れる', () => {
    const legacy = supabaseConfig({
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    } as unknown as NodeJS.ProcessEnv);
    const modern = supabaseConfig({
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'pub-key',
      SUPABASE_SECRET_KEY: 'secret-key',
    } as unknown as NodeJS.ProcessEnv);

    expect(legacy?.anonKey).toBe('anon-key');
    expect(legacy?.serviceKey).toBe('service-key');
    expect(modern?.anonKey).toBe('pub-key');
    expect(modern?.serviceKey).toBe('secret-key');
  });

  it('引用符や改行が混ざっていても拾う', () => {
    const config = supabaseConfig({
      NEXT_PUBLIC_SUPABASE_URL: ' "https://example.supabase.co" ',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key\n',
    } as unknown as NodeJS.ProcessEnv);

    expect(config?.url).toBe('https://example.supabase.co');
    expect(config?.anonKey).toBe('anon-key');
  });
});
