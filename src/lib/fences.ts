/**
 * 囲みブロックの中身を、サーバー側で差し替えるための道具。
 *
 * モデルには「何を出すか」だけを書かせ、中身の事実（商品の価格、持ち物の本数）は
 * こちらで埋めます。その差し替えを行う場所が2つ以上できたので、走査だけを切り出しました。
 *
 * 閉じていないブロックには触れません。生成の途中で切れているだけかもしれず、
 * そこで消してしまうと本文まで欠けます。
 */

/**
 * ```<tag> ... ``` の中身を resolve の戻り値に差し替える。
 * resolve が null を返したブロックは、丸ごと取り除く。
 */
export function mapFencedBlocks(
  text: string,
  tag: string,
  resolve: (raw: string) => string | null,
): string {
  const open = new RegExp(`^\`\`\`${tag}\\s*$`);
  if (!text.includes('```' + tag)) return text;

  const lines = text.split('\n');
  const out: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!open.test(lines[index])) {
      out.push(lines[index]);
      continue;
    }

    let end = index + 1;
    const body: string[] = [];
    while (end < lines.length && lines[end].trim() !== '```') {
      body.push(lines[end]);
      end += 1;
    }
    if (end >= lines.length) {
      // 閉じていない。生成の途中なので、そのまま残す。
      out.push(...lines.slice(index));
      break;
    }

    const resolved = resolve(body.join('\n'));
    if (resolved === null) {
      // 差し替えられないブロックは消す。直前の空行も一緒に畳んでおく。
      while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
    } else {
      out.push('```' + tag, resolved, '```');
    }
    index = end;
  }

  return out.join('\n');
}
