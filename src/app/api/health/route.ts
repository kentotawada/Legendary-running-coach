import { getBuildInfo } from '@/lib/build-info';
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

export async function GET() {
  const database = await checkDatabase();

  return Response.json(
    { ok: true, checkedAt: new Date().toISOString(), ...getBuildInfo(), ...database },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
