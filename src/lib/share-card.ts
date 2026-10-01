/**
 * 「過去の自分と比べて」を、1枚の画像にする。
 *
 * **このアプリでいちばん人に見せたくなる画面なのに、外に出す口が無かった。**
 * スクリーンショットは撮れるが、名前も体重も一緒に写るので、そのままは貼れない。
 *
 * ここで作る画像には、**本人を特定できるものを一切入れない。**
 * 入るのは、距離・ペース・心拍・差だけ。名前も日付も入れない。
 *
 * 文字を描く部分（折り返し・中身の組み立て）は、canvas を使わずに済むように
 * 分けてある。テストの環境には canvas が無いため。
 */

import type { RunComparison } from './compare';
import { describeComparison, paceText } from './compare';

/** 書き出す大きさ。縦長（4:5）は、SNSで画面をいちばん広く取れる形。 */
export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;
const PADDING = 72;

export interface ShareStat {
  label: string;
  value: string;
  /** 差の表示（-12秒 など）。無い時もある。 */
  delta?: string;
}

/**
 * ペースの比較。**数字の行ではなく、棒で見せる。**
 * 「5:42 → 5:30」は読まないと分からないが、棒の長さの違いは見た瞬間に分かる。
 */
export interface ShareBars {
  caption: string;
  rows: { label: string; text: string; /** 0〜1。長いほど遅い。 */ ratio: number; fast: boolean }[];
  /** 棒の下に1行。差を言葉で。 */
  summary: string;
}

export interface ShareCardContent {
  label: string;
  title: string;
  detail: string;
  bars: ShareBars | null;
  stats: ShareStat[];
  brand: string;
  note: string;
  /** 良くなった時だけ、色を変える。 */
  highlight: boolean;
}

const BRAND = 'RUNCOACH';
const NOTE = '走った記録を、過去の自分と比べています';

/**
 * 画像に載せる中身を組み立てる。
 *
 * **画面に出しているものと、同じ言葉を使う。** 共有した画像にだけ
 * 調子のいいことが書いてあると、見た人が実物を開いた時に食い違う。
 */
export function shareCardContent(comparison: RunComparison): ShareCardContent {
  const { title, detail } = describeComparison(comparison);

  const stats: ShareStat[] = [];

  // 棒の長さは、1kmにかかった時間に比例させる。短いほうが速い。
  const slowest = Math.max(comparison.pastPaceSec, comparison.nowPaceSec);
  const bars: ShareBars = {
    caption: `1kmあたりにかかった時間（${comparison.nowKm}km前後での比較）`,
    rows: [
      {
        label: '前',
        text: paceText(comparison.pastPaceSec),
        ratio: comparison.pastPaceSec / slowest,
        fast: comparison.pastPaceSec < comparison.nowPaceSec,
      },
      {
        label: '今日',
        text: paceText(comparison.nowPaceSec),
        ratio: comparison.nowPaceSec / slowest,
        fast: comparison.nowPaceSec <= comparison.pastPaceSec,
      },
    ],
    summary:
      comparison.paceDeltaSec === 0
        ? '前と同じペースです'
        : comparison.paceDeltaSec > 0
          ? `1kmあたり ${comparison.paceDeltaSec}秒 かかっています`
          : `1kmあたり ${-comparison.paceDeltaSec}秒 速くなりました`,
  };

  if (comparison.pastHr !== undefined && comparison.nowHr !== undefined) {
    stats.push({
      label: '平均心拍',
      value: `${comparison.pastHr} → ${comparison.nowHr}`,
      delta:
        comparison.hrDelta === undefined || comparison.hrDelta === 0
          ? '±0'
          : comparison.hrDelta > 0
            ? `+${comparison.hrDelta}`
            : `${comparison.hrDelta}`,
    });
  }

  if (comparison.efficiencyPercent !== undefined) {
    stats.push({
      label: '同じ心拍で進める量',
      value: `${comparison.efficiencyPercent > 0 ? '+' : ''}${comparison.efficiencyPercent}%`,
    });
  }

  return {
    label: '過去の自分と比べて',
    title,
    detail,
    bars,
    stats,
    brand: BRAND,
    note: NOTE,
    highlight: comparison.verdict === 'better',
  };
}

/**
 * 行の先頭に置かない文字。
 * **ここを見ないと、句点だけが次の行の頭に落ちる。**
 */
const NO_LINE_START = '、。，．）」』】〕〉》！？・ー…%％';
/** 行の末尾に置かない文字。 */
const NO_LINE_END = '（「『【〔〈《';

/**
 * 日本語の折り返し。
 *
 * **単語で切る西洋式は使えない。** 日本語は空白で切れないので文字ごとに見る。
 * ただし「5:42/km」「+6.4%」のような並びは**途中で切らない**。
 * 数字が行をまたぐと、読めない上に、数字そのものを疑われる。
 */
export function splitTokens(text: string): string[] {
  const tokens: string[] = [];
  let latin = '';
  for (const char of text) {
    if (/[0-9A-Za-z:./+\-%]/.test(char)) {
      latin += char;
      continue;
    }
    if (latin) {
      tokens.push(latin);
      latin = '';
    }
    tokens.push(char);
  }
  if (latin) tokens.push(latin);
  return tokens;
}

/** 幅を測る関数を外から渡す。canvas の無いところでも確かめられるように。 */
export type Measure = (text: string) => number;

export function wrapText(text: string, maxWidth: number, measure: Measure): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    const tokens = splitTokens(paragraph);
    let line = '';

    for (const token of tokens) {
      const next = line + token;
      const fits = measure(next) <= maxWidth;

      // 行頭に置けない文字は、はみ出してでも前の行に残す。
      if (!fits && line && !NO_LINE_START.includes(token)) {
        // 行末に置けない文字は、次の行へ送る。
        const last = line.slice(-1);
        if (NO_LINE_END.includes(last)) {
          lines.push(line.slice(0, -1));
          line = last + token;
        } else {
          lines.push(line);
          line = token;
        }
        continue;
      }
      line = next;
    }

    lines.push(line);
  }

  return lines;
}

export interface Palette {
  bg: string;
  fg: string;
  muted: string;
  accent: string;
  line: string;
  sunken: string;
  fontFamily: string;
}

/** 画面に出ている色をそのまま使う。**共有した画像だけ別の見た目にしない。** */
const FALLBACK: Palette = {
  bg: '#fcfcfb',
  fg: '#1a1a18',
  muted: '#6b6b66',
  accent: '#e8590c',
  line: '#e4e4e0',
  sunken: '#f2f2f0',
  fontFamily:
    'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif',
};

export function paletteFromDocument(): Palette {
  if (typeof document === 'undefined') return FALLBACK;
  try {
    const style = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
    return {
      bg: read('--bg', FALLBACK.bg),
      fg: read('--fg', FALLBACK.fg),
      muted: read('--muted', FALLBACK.muted),
      accent: read('--accent', FALLBACK.accent),
      line: read('--line', FALLBACK.line),
      sunken: read('--bg-sunken', FALLBACK.sunken),
      fontFamily: getComputedStyle(document.body).fontFamily || FALLBACK.fontFamily,
    };
  } catch {
    return FALLBACK;
  }
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

/**
 * 1枚の画像にして返す。
 *
 * **canvas が無い環境では null。** ここで例外を投げると、
 * 共有ボタンを押しただけで画面が落ちる。
 */
export async function renderShareCard(
  content: ShareCardContent,
  palette: Palette = paletteFromDocument(),
): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const font = (size: number, weight = '400') => `${weight} ${size}px ${palette.fontFamily}`;
  const measureWith = (size: number, weight = '400'): Measure => {
    return (text: string) => {
      ctx.font = font(size, weight);
      return ctx.measureText(text).width;
    };
  };

  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const inner = CARD_WIDTH - PADDING * 2;
  let y = PADDING;

  // 目印の線。1本あるだけで、作られた物に見える。
  ctx.fillStyle = palette.accent;
  roundedRect(ctx, PADDING, y, 96, 10, 5);
  ctx.fill();
  y += 10 + 46;

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = palette.muted;
  ctx.font = font(34);
  ctx.fillText(content.label, PADDING, y);
  y += 72;

  // 見出し。良くなった時だけ色を変える。
  ctx.fillStyle = content.highlight ? palette.accent : palette.fg;
  ctx.font = font(62, '700');
  for (const line of wrapText(content.title, inner, measureWith(62, '700')).slice(0, 2)) {
    ctx.font = font(62, '700');
    ctx.fillText(line, PADDING, y);
    y += 82;
  }

  y += 24;
  ctx.fillStyle = palette.muted;
  for (const line of wrapText(content.detail, inner, measureWith(38)).slice(0, 5)) {
    ctx.font = font(38);
    ctx.fillText(line, PADDING, y);
    y += 58;
  }

  y += 40;
  ctx.fillStyle = palette.line;
  ctx.fillRect(PADDING, y, inner, 2);
  y += 58;

  /*
    **棒で見せる。** 「5:42 → 5:30」は読まないと分からないが、
    長さの違いは見た瞬間に分かる。貼られた画像は、たいてい読まれずに見られる。
  */
  if (content.bars) {
    ctx.fillStyle = palette.muted;
    ctx.font = font(28);
    ctx.fillText(content.bars.caption, PADDING, y);
    y += 46;

    const labelWidth = 92;
    const valueWidth = 132;
    const trackX = PADDING + labelWidth;
    const trackWidth = inner - labelWidth - valueWidth;
    const barHeight = 58;

    for (const row of content.bars.rows) {
      ctx.fillStyle = palette.muted;
      ctx.font = font(30);
      ctx.textAlign = 'left';
      ctx.fillText(row.label, PADDING, y + barHeight / 2 + 11);

      ctx.fillStyle = palette.sunken;
      roundedRect(ctx, trackX, y, trackWidth, barHeight, barHeight / 2);
      ctx.fill();

      // 短いほうが速い。長さは、1kmにかかった時間に比例する。
      ctx.fillStyle = row.fast ? palette.accent : palette.line;
      roundedRect(ctx, trackX, y, Math.max(barHeight, trackWidth * row.ratio), barHeight, barHeight / 2);
      ctx.fill();

      ctx.fillStyle = palette.fg;
      ctx.font = font(40, '700');
      ctx.textAlign = 'right';
      ctx.fillText(row.text, PADDING + inner, y + barHeight / 2 + 14);
      ctx.textAlign = 'left';

      y += barHeight + 18;
    }

    ctx.fillStyle = content.highlight ? palette.accent : palette.muted;
    ctx.font = font(32, '600');
    ctx.fillText(content.bars.summary, PADDING, y + 26);
    y += 86;
  }

  /*
    数字は**2列に並べる。** 縦に積むと下の署名とぶつかるし、
    縦長の画像は、下へ行くほど読まれない。
  */
  const columns = 2;
  const columnWidth = inner / columns;
  content.stats.forEach((stat, index) => {
    const x = PADDING + (index % columns) * columnWidth;
    const row = Math.floor(index / columns);
    const top = y + row * 112;

    ctx.fillStyle = palette.muted;
    ctx.font = font(28);
    ctx.fillText(stat.label, x, top);

    ctx.fillStyle = palette.fg;
    ctx.font = font(50, '700');
    ctx.fillText(stat.value, x, top + 62);

    if (stat.delta) {
      const width = ctx.measureText(stat.value).width;
      ctx.fillStyle = palette.muted;
      ctx.font = font(32);
      ctx.fillText(stat.delta, x + width + 18, top + 62);
    }
  });

  // 下。名前は入れない。入れるのは、どこで作られたものかだけ。
  const footerY = CARD_HEIGHT - PADDING;
  ctx.fillStyle = palette.muted;
  ctx.font = font(28);
  ctx.fillText(content.note, PADDING, footerY);

  ctx.fillStyle = palette.fg;
  ctx.font = font(36, '700');
  ctx.fillText(content.brand, PADDING, footerY - 48);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

/** 保存した時のファイル名。**日付は入れない。** いつ走ったかも、本人の情報。 */
export const SHARE_FILE_NAME = 'runcoach.png';
