import { getBuildInfo } from '@/lib/build-info';
import { createSupabaseAdminClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DatabaseStatus =
  | { database: 'not-configured' }
  | { database: 'ok'; rows: number }
  | { database: 'error'; databaseError: string; hint: string };

/** 生のエラー文だけでは何を直せばよいか分からないので、よくある原因を言葉にする。 */
function hintFor(code: string | undefined, message: string): string {
  if (code === '42P01' || /relation .* does not exist|could not find the table/i.test(message)) {
    return 'coach_states テーブルがありません。supabase/schema.sql を SQL Editor で実行してください。';
  }
  if (code === '42501' || /permission denied/i.test(message)) {
    return 'キーの権限が足りません。SUPABASE_SERVICE_ROLE_KEY に service_role（secret）キーを設定しているか確認してください。';
  }
  if (/invalid api key|jwt|unauthorized/i.test(message)) {
    return 'キーが正しくありません。Project Settings → API の値をもう一度コピーしてください。';
  }
  if (/fetch failed|enotfound|getaddrinfo|econnrefused/i.test(message)) {
    return 'データベースに接続できません。NEXT_PUBLIC_SUPABASE_URL が正しいか、プロジェクトが一時停止していないか確認してください。';
  }
  return '環境変数を更新した後は、再デプロイが必要です。';
}

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
      hint: hintFor(error.code, error.message),
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
