import { cleanEnv } from './env';
import { modelName, visionModelName } from './models';
import { dailyBudget } from './quota';

// これまでどおり build-info から読めるようにしておく。
export { cleanEnv };

/**
 * 「今わたしはどのビルドを見ているのか」に、アプリ自身が答えられるようにする。
 * デプロイ先で古いビルドを見続けている、という事故を一目で切り分けるため。
 */
export interface BuildInfo {
  /** デプロイ元のコミット（分かる場合）。 */
  commit: string;
  /** ふだんの会話に使うモデル名。 */
  model: string;
  /** 画像を読む時だけ使うモデル名。 */
  visionModel: string;
  /**
   * アプリ全体で1日に話せる回数（DAILY_TURN_BUDGET）。
   *
   * **1日の請求が、どこで止まるかの数字。** 環境変数を直してリデプロイしたのに
   * 効いていない、という事故がいちばん起きやすい設定なので、ここから確かめられるようにする。
   * 秘密ではない（上限に当たれば、使っている人には画面で分かる）。
   */
  dailyTurnBudget: number;
  thinkingLevel: string;
  /** キーが設定されているか。値そのものは絶対に返さない。 */
  hasApiKey: boolean;
  /**
   * キーが明らかに壊れていないか。
   * 引用符や改行の混入、貼り付けの取りこぼしを見つけるための目安であって、
   * 有効性の判定ではない。キーの形式は提供側の都合で変わり得る。
   */
  apiKeyLooksValid: boolean;
  environment: string;
  /** 記録の保存先。supabase なら永続、file ならこのインスタンス限り。 */
  storage: 'supabase' | 'file';
  /** ログイン機能が使えるか。 */
  authAvailable: boolean;
  /**
   * 実在する商品の候補を取れるか。
   * 「環境変数を入れたのに商品が出ない」を、ここだけ見て切り分けられるようにする。
   */
  productSearch: boolean;
  /** ランニングアプリ（Strava）との連携が使えるか。 */
  stravaAvailable: boolean;
  /** プッシュ通知の鍵が設定されているか。 */
  pushAvailable: boolean;
}


export function getBuildInfo(): BuildInfo {
  const key = cleanEnv(process.env.GEMINI_API_KEY);
  const supabaseUrl = cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const supabaseAnonKey =
    cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ||
    cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const supabaseServiceKey =
    cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY) || cleanEnv(process.env.SUPABASE_SECRET_KEY);
  const commit = cleanEnv(process.env.VERCEL_GIT_COMMIT_SHA) || cleanEnv(process.env.COACH_COMMIT_SHA);

  return {
    commit: commit ? commit.slice(0, 7) : 'local',
    model: modelName(),
    visionModel: visionModelName(),
    dailyTurnBudget: dailyBudget(),
    thinkingLevel: (cleanEnv(process.env.GEMINI_THINKING_LEVEL) || 'LOW').toUpperCase(),
    hasApiKey: key.length > 0,
    // 特定の接頭辞を求めない。空白混入と短すぎる値だけを弾く。
    apiKeyLooksValid: key.length >= 20 && !/\s/.test(key),
    environment: cleanEnv(process.env.VERCEL_ENV) || process.env.NODE_ENV || 'development',
    // service_role キーが無いと読み書きできないので、保存先の判定はこれで行う。
    storage: supabaseUrl && supabaseServiceKey ? 'supabase' : 'file',
    authAvailable: Boolean(supabaseUrl && supabaseAnonKey),
    productSearch: cleanEnv(process.env.RAKUTEN_APP_ID).length > 0,
    stravaAvailable:
      cleanEnv(process.env.STRAVA_CLIENT_ID).length > 0 &&
      cleanEnv(process.env.STRAVA_CLIENT_SECRET).length > 0,
    pushAvailable:
      (cleanEnv(process.env.VAPID_PUBLIC_KEY).length > 0 ||
        cleanEnv(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY).length > 0) &&
      cleanEnv(process.env.VAPID_PRIVATE_KEY).length > 0,
  };
}
