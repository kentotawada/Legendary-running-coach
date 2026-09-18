/**
 * 「今わたしはどのビルドを見ているのか」に、アプリ自身が答えられるようにする。
 * デプロイ先で古いビルドを見続けている、という事故を一目で切り分けるため。
 */
export interface BuildInfo {
  /** デプロイ元のコミット（分かる場合）。 */
  commit: string;
  /** 設定されているモデル名。 */
  model: string;
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
}

/** 環境変数に紛れ込んだ引用符や空白を落とす。貼り付け事故がここで死なないように。 */
export function cleanEnv(value: string | undefined): string {
  if (!value) return '';
  return value.trim().replace(/^["']|["']$/g, '').trim();
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
    model: cleanEnv(process.env.GEMINI_MODEL) || 'gemini-3-pro-preview',
    thinkingLevel: (cleanEnv(process.env.GEMINI_THINKING_LEVEL) || 'LOW').toUpperCase(),
    hasApiKey: key.length > 0,
    // 特定の接頭辞を求めない。空白混入と短すぎる値だけを弾く。
    apiKeyLooksValid: key.length >= 20 && !/\s/.test(key),
    environment: cleanEnv(process.env.VERCEL_ENV) || process.env.NODE_ENV || 'development',
    // service_role キーが無いと読み書きできないので、保存先の判定はこれで行う。
    storage: supabaseUrl && supabaseServiceKey ? 'supabase' : 'file',
    authAvailable: Boolean(supabaseUrl && supabaseAnonKey),
  };
}
