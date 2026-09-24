/**
 * モデルが、ツール呼び出しを「本文」として書いてしまった時の受け皿。
 *
 * Gemini は本来 functionCall として返すべき内容を、
 * まれに地の文へ書き出すことがある。そのまま表示すると
 * set_today_plan { "title": ... } という内部処理用の JSON が
 * ランナーの画面に出てしまう。
 *
 * ここでは2つのことをする。
 *  1. 本文から取り除く（画面に出さない）
 *  2. 取り出した内容をツールとして実行する（記録を失わない）
 *
 * 取り除くだけだと、コーチが渡したはずのメニューが記録されずに消える。
 */

/** 本文に紛れ込み得るツール名。tools.ts の宣言と一致していることをテストで担保する。 */
export const COACH_TOOL_NAMES = [
  'update_runner_profile',
  'add_race',
  'remove_race',
  'log_condition',
  'update_pain',
  'log_activity',
  'set_today_plan',
  'log_weight',
  'set_coaching_phase',
  'add_shoes',
  'retire_shoes',
  'log_gear_feedback',
  // 本文に書かれても記録としては実行できない（商品検索は非同期のため）が、
  // 内部処理用の JSON を画面に残さないよう、取り除く対象には入れておく。
  'find_gear',
] as const;

export interface TextToolCall {
  name: string;
  args: unknown;
}

export interface ExtractResult {
  /** ツール呼び出しを取り除いた本文。 */
  cleaned: string;
  calls: TextToolCall[];
  /** 閉じていない途中の呼び出しがあったか（生成中の判定に使う）。 */
  truncated: boolean;
}

/** 文字列リテラルを考慮して、対応する閉じ括弧の位置を返す。見つからなければ -1。 */
function matchBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const NAME_PATTERN = new RegExp(
  // 行頭の装飾（バッククォート、記号、番号）は許す。
  // ツール名と JSON の間に空行が入ることがあるため、改行は何個でも許す。
  `(^|\\n)[ \\t]*[\`*#>\\-]*[ \\t]*(${COACH_TOOL_NAMES.join('|')})[\`*]*[ \\t]*:?[ \\t]*(?:\\r?\\n[ \\t]*)*(?=\\{)`,
  'g',
);

/**
 * 本文からツール呼び出しらしき記述を取り出す。
 * ツール名の直後に JSON オブジェクトが続く形だけを対象にし、
 * 単に名前が会話に出てきただけのものは触らない。
 */
export function extractTextToolCalls(text: string): ExtractResult {
  const calls: TextToolCall[] = [];
  const removals: { start: number; end: number }[] = [];
  let truncated = false;

  NAME_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = NAME_PATTERN.exec(text)) !== null) {
    const leading = match[1] ? match[1].length : 0;
    const start = match.index + leading;
    const braceIndex = text.indexOf('{', match.index);
    if (braceIndex === -1) continue;

    const end = matchBrace(text, braceIndex);
    if (end === -1) {
      // まだ生成途中。ここから先は表示しない。
      truncated = true;
      removals.push({ start, end: text.length });
      break;
    }

    try {
      calls.push({ name: match[2], args: JSON.parse(text.slice(braceIndex, end + 1)) });
    } catch {
      // JSON として読めなくても、画面には出さない。
    }
    removals.push({ start, end: end + 1 });
    NAME_PATTERN.lastIndex = end + 1;
  }

  if (removals.length === 0) return { cleaned: text, calls, truncated };

  let cleaned = '';
  let cursor = 0;
  for (const removal of removals) {
    cleaned += text.slice(cursor, removal.start);
    cursor = removal.end;
  }
  cleaned += text.slice(cursor);

  // 取り除いた跡の空行が続かないよう整える。
  return { cleaned: cleaned.replace(/\n{3,}/g, '\n\n').trim(), calls, truncated };
}

/** 生成途中でも、ツール名が出た時点でそこから先を隠す（JSONのちらつきを防ぐ）。 */
export function stripToolTextForDisplay(text: string): string {
  return extractTextToolCalls(text).cleaned;
}
