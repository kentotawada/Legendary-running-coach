/**
 * 通信が失敗した時に、何が起きたのかを画面で言い当てるための翻訳。
 *
 * ここが雑だと「通信に失敗しました。」の一行だけが出て、
 * 送った本人にも作った側にも原因が分からない。実際にそれが起きた。
 * HTTP の状態番号と、サーバーが返した本文の断片を必ず残す。
 */

export interface TransportFailure {
  /** 画面に出す一文。次に何をすればいいかまで含める。 */
  message: string;
  /** 「詳細を表示」で開く中身。原因の切り分けに使う。 */
  detail: string | null;
  /** もう一度送り直す価値があるか。容量超過のように、同じものを送っても無駄な失敗は false。 */
  retryable: boolean;
}

const TIMEOUT_MARKERS =
  /FUNCTION_INVOCATION_TIMEOUT|TIMEOUT|timed? ?out|Gateway Time-?out|504/i;

/** サーバーが返した本文から、アプリ自身の JSON エラーを取り出す。 */
function parseOwnError(body: string): { error?: string; hint?: string } | null {
  const trimmed = body.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as { error?: unknown; hint?: unknown };
    if (typeof parsed.error !== 'string') return null;
    return {
      error: parsed.error,
      hint: typeof parsed.hint === 'string' ? parsed.hint : undefined,
    };
  } catch {
    return null;
  }
}

function excerpt(body: string, limit = 400): string {
  const compact = body.replace(/\s+/g, ' ').trim();
  return compact.length > limit ? `${compact.slice(0, limit)}…` : compact;
}

/**
 * 応答が返ってきたが、うちのストリームではなかった場合。
 * Vercel などの実行基盤が返す HTML や素のテキストがここに来る。
 */
export function describeHttpFailure(
  status: number,
  statusText: string,
  body: string,
): TransportFailure {
  const detail = [`HTTP ${status}${statusText ? ` ${statusText}` : ''}`, excerpt(body)]
    .filter(Boolean)
    .join('\n');

  const own = parseOwnError(body);
  if (own?.error) {
    return { message: own.error, detail: own.hint ?? detail, retryable: false };
  }

  if (status === 413) {
    return {
      message:
        '画像が大きすぎて送れませんでした。枚数を減らすか、何回かに分けて送ってください。',
      detail,
      retryable: false,
    };
  }

  if (status === 408 || status === 504 || (status >= 500 && TIMEOUT_MARKERS.test(body))) {
    return {
      message:
        '返事を作るのに時間がかかりすぎて、途中で打ち切られました。画像の枚数を減らすか、少し時間をおいてもう一度送ってください。',
      detail,
      retryable: true,
    };
  }

  if (status === 502 || status === 503) {
    return {
      message: 'サーバーが混み合っています。少し時間をおいて、もう一度送ってください。',
      detail,
      retryable: true,
    };
  }

  if (status === 401 || status === 403) {
    return {
      message: 'この操作の権限がありませんでした。一度ログインし直してください。',
      detail,
      retryable: false,
    };
  }

  if (status >= 500) {
    return {
      message: 'サーバー側でエラーが起きました。もう一度送ってみてください。',
      detail,
      retryable: true,
    };
  }

  return {
    message: `送信できませんでした（HTTP ${status}）。もう一度試してください。`,
    detail,
    retryable: true,
  };
}

/**
 * 受信の途中で切れた場合。
 * 返事が流れ始めてから止まるので、状態番号は残っていない。
 */
export function describeStreamFailure(error: unknown): TransportFailure {
  const name = error instanceof Error ? error.name : '';
  const raw = error instanceof Error ? error.message : String(error);
  const detail = `${name || 'Error'}: ${raw || '詳細不明'}`;

  if (name === 'AbortError' || /aborted/i.test(raw)) {
    return {
      message:
        '返事が返ってこないまま時間切れになりました。画像の枚数を減らすか、少し時間をおいてもう一度送ってください。',
      detail,
      retryable: true,
    };
  }

  if (TIMEOUT_MARKERS.test(raw)) {
    return {
      message: '返事を作るのに時間がかかりすぎました。もう一度送ってみてください。',
      detail,
      retryable: true,
    };
  }

  return {
    message:
      '返事の途中で通信が切れました。電波の良い場所で、もう一度送ってみてください。',
    detail,
    retryable: true,
  };
}

/** 1ターンを待つ上限。これを超えたら、黙って固まらせずに打ち切る。 */
export const TURN_TIMEOUT_MS = 300_000;
