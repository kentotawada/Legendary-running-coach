/**
 * 保存層の失敗を、直せる形にして持ち回るための型。
 *
 * 「コーチへの接続がうまくいきませんでした」とだけ出すと、
 * 実際にはコーチは答えていて保存だけが失敗している場合でも、
 * 原因の見当がつかなくなる。何が失敗したのかを分けて伝える。
 */
export class StorageError extends Error {
  constructor(
    message: string,
    readonly detail: string,
    readonly hint: string,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

/** 生のエラー文だけでは何を直せばよいか分からないので、よくある原因を言葉にする。 */
export function storageHint(code: string | undefined, message: string): string {
  if (code === '42P01' || /relation .* does not exist|could not find the table/i.test(message)) {
    return 'coach_states テーブルがありません。supabase/schema.sql を Supabase の SQL Editor で実行してください。';
  }
  if (code === '42501' || /permission denied|row-level security/i.test(message)) {
    return 'キーの権限が足りません。SUPABASE_SERVICE_ROLE_KEY に service_role（secret）キーを設定しているか確認してください。anon キーでは書き込めません。';
  }
  if (/invalid api key|jwt|unauthorized|invalid claim/i.test(message)) {
    return 'キーが正しくありません。Project Settings → API の値をもう一度コピーし、再デプロイしてください。';
  }
  if (/fetch failed|enotfound|getaddrinfo|econnrefused|timeout/i.test(message)) {
    return 'データベースに接続できません。NEXT_PUBLIC_SUPABASE_URL が正しいか、プロジェクトが一時停止していないか確認してください。';
  }
  if (code === '23503' || /foreign key/i.test(message)) {
    return 'ログイン情報とデータの対応が取れていません。一度ログアウトして、入り直してみてください。';
  }
  if (code === '22001' || /value too long/i.test(message)) {
    return '保存しようとしたデータが大きすぎます。カルテから記録を消去すると復旧します。';
  }
  return '環境変数を変更した後は、再デプロイが必要です。/api/health で保存先の状態を確認できます。';
}

export function storageError(action: string, code: string | undefined, message: string): StorageError {
  return new StorageError(
    `${action}に失敗しました。データベースの設定を確認してください。`,
    `${code ?? ''} ${message}`.trim(),
    storageHint(code, message),
  );
}

/** ルートハンドラで使う、原因の分かる 500 応答。 */
export function storageErrorResponse(error: unknown, what: string): Response {
  console.error(`[coach] ${what}`, error);
  if (error instanceof StorageError) {
    return Response.json(
      { error: error.message, detail: error.detail, hint: error.hint },
      { status: 500 },
    );
  }
  return Response.json(
    {
      error: `${what}。データベースの設定を確認してください。`,
      detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      hint: '/api/health で保存先の状態を確認できます。',
    },
    { status: 500 },
  );
}
