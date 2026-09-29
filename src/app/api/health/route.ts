import { getBuildInfo } from '@/lib/build-info';
import { pendingSetup } from '@/lib/setup';
import { createSupabaseAdminClient } from '@/lib/supabase';
import { storageHint } from '@/lib/storage-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DatabaseStatus =
  | { database: 'not-configured' }
  | { database: 'ok'; rows: number }
  | { database: 'error'; databaseError: string; hint: string };

/**
 * 設定を確認するだけでなく、実際にテーブルへ問い合わせる。
 * 「環境変数は入っているのに動かない」の原因は、たいてい
 * テーブル未作成かキーの取り違えなので、そこまで見て初めて確認になる。
 */
async function checkDatabase(): Promise<DatabaseStatus> {
  const client = createSupabaseAdminClient();
  if (!client) return { database: 'not-configured' };

  const { count, error } = await client
    .from('coach_states')
    .select('user_id', { count: 'exact', head: true });

  if (error) {
    // キーや接続情報そのものは含まれないため、原因究明のためにそのまま返す。
    return {
      database: 'error',
      databaseError: `${error.code ?? ''} ${error.message}`.trim(),
      hint: storageHint(error.code, error.message),
    };
  }
  return { database: 'ok', rows: count ?? 0 };
}

/**
 * 1日の上限を数える仕組みが動いているか。
 *
 * **ここが動いていないと、上限は黙って外れる**（数えられない時は止めずに通す作りのため）。
 * SQL を流し忘れていても画面は普通に動くので、ここで見えるようにしておく。
 */
async function checkUsage(): Promise<{ usage: 'ok' | 'not-configured' | 'error'; usageError?: string }> {
  const client = createSupabaseAdminClient();
  if (!client) return { usage: 'not-configured' };
  // 0 を足すだけ。数は変わらない。
  const { error } = await client.rpc('bump_usage', { p_key: 'health', p_by: 0 });
  if (error) return { usage: 'error', usageError: `${error.code ?? ''} ${error.message}`.trim() };
  return { usage: 'ok' };
}

export async function GET() {
  const [database, usage] = await Promise.all([checkDatabase(), checkUsage()]);

  return Response.json(
    {
      ok: true,
      checkedAt: new Date().toISOString(),
      ...getBuildInfo(),
      ...database,
      ...usage,
      // **まだ足りないもの。** 名前だけで、値は返さない。
      pending: pendingSetup(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
