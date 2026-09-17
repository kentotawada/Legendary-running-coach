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
  /** キーの形が Google AI Studio のものらしいか。引用符や改行の混入を見つけるため。 */
  apiKeyLooksValid: boolean;
  environment: string;
}

/** 環境変数に紛れ込んだ引用符や空白を落とす。貼り付け事故がここで死なないように。 */
export function cleanEnv(value: string | undefined): string {
  if (!value) return '';
  return value.trim().replace(/^["']|["']$/g, '').trim();
}

export function getBuildInfo(): BuildInfo {
  const key = cleanEnv(process.env.GEMINI_API_KEY);
  const commit = cleanEnv(process.env.VERCEL_GIT_COMMIT_SHA) || cleanEnv(process.env.COACH_COMMIT_SHA);

  return {
    commit: commit ? commit.slice(0, 7) : 'local',
    model: cleanEnv(process.env.GEMINI_MODEL) || 'gemini-3-pro-preview',
    thinkingLevel: (cleanEnv(process.env.GEMINI_THINKING_LEVEL) || 'LOW').toUpperCase(),
    hasApiKey: key.length > 0,
    apiKeyLooksValid: /^AIza[0-9A-Za-z_-]{30,}$/.test(key),
    environment: cleanEnv(process.env.VERCEL_ENV) || process.env.NODE_ENV || 'development',
  };
}
