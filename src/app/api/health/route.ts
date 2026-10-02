import { getBuildInfo } from '@/lib/build-info';
import { checkVapidPair } from '@/lib/push';
import { blockingSetup, pendingSetup, readyToShare } from '@/lib/setup';
import { pricesFromEnv } from '@/lib/admin';
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
  const prices = pricesFromEnv();

  return Response.json(
    {
      ok: true,
      checkedAt: new Date().toISOString(),
      ...getBuildInfo(),
      ...database,
      ...usage,
      /*
        **人に配れる状態か。ここだけ見れば分かるようにする。**
        pending は Strava も Stripe も含むので、当分ずっと空にならない。
        それを「まだ足りない」と読むか、並んでいるのを見慣れて
        本当に足りないものを見落とすか、どちらかになっていた。
      */
      /*
        通知の公開鍵と秘密鍵が、対になっているか。

        **ここは、設定がそろって見えるのに動かない唯一の場所。**
        web-push は長さと文字種しか見ないので、別々に作った鍵を
        組み合わせても素通しする。pushAvailable は true のまま、
        通知だけが1通も届かず、エラーもどこにも出ない。
        鍵を作り直して片方だけ貼り替えると、必ずこうなる。
      */
      vapidPair: checkVapidPair(),
      readyToShare: readyToShare(),
      /** 無くては困るのに足りないもの。**空でなければ人に配れない。** */
      blocking: blockingSetup(),
      /*
        単価。**値まで出す。** Google の公開価格なので隠すものではないし、
        入っているかどうかだけでは「上位モデルの単価（2,12）のまま」を
        見つけられない。それだと /admin の金額が実際の4倍になり、
        値付けの判断ごと間違える。
      */
      priceUsdPerMTok: prices ? { in: prices.inputPerMTok, out: prices.outputPerMTok } : null,
      // **まだ足りないもの。** 名前だけで、値は返さない。
      pending: pendingSetup(),
    },
    {
      headers: {
        'Cache-Control': 'no-store',
        /*
          **文字コードを明示する。**
          JSON は規格上いつも UTF-8 なので省いてもよいことになっているが、
          省くと、ブラウザがこれを「ダウンロードしたファイル」として開いた時に
          文字コードを推測する。iOS Safari は日本語を別の文字コードとして読み、
          足りない設定の名前が読めない文字の列になった。
          **読むために出しているものが読めなければ、出していないのと同じ。**
        */
        'Content-Type': 'application/json; charset=utf-8',
      },
    },
  );
}
