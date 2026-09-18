import { parseRichText, type InlineText, type RichBlock } from './richtext';
import { stripToolTextForDisplay } from './tool-text';

/**
 * 読み上げ用のテキスト。
 *
 * 画面用の文字列をそのまま読ませると、「アスタリスク アスタリスク」「スラッシュ ケーエム」と
 * 記号まで音になる。走った直後に耳で聞く人にとっては、それだけで使い物にならない。
 * ここで記号を落とし、数字を日本語として読める形に直す。
 */

function flatten(parts: InlineText[]): string {
  return parts.map((part) => part.value).join('');
}

/** 絵文字と装飾記号。読み上げると名前が読まれてしまう。 */
const DECORATION = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu;

/**
 * 数字と単位を、耳で分かる形に直す。
 * 「4:15/km」を「よん じゅうご わる けーえむ」と読まれては意味が通らない。
 */
export function speakableNumbers(text: string): string {
  return (
    text
      // "4:15/km" → 4分15秒パーキロ
      .replace(/(\d{1,2}):(\d{2})\s*\/\s*km/g, '$1分$2秒パーキロ')
      // "2:59:59" → 2時間59分59秒
      .replace(/(\d{1,2}):(\d{2}):(\d{2})/g, '$1時間$2分$3秒')
      // ここまでで時:分:秒とペースは消えているので、残った "20:00" は分と秒。
      // 後読みは古い iOS Safari が解釈できず、読み込んだ瞬間に画面全体が落ちるので使わない。
      .replace(/(\d{1,2}):(\d{2})/g, '$1分$2秒')
      .replace(/(\d)\s*km/g, '$1キロ')
      .replace(/(\d)\s*bpm/g, '$1拍')
      .replace(/(\d)\s*kg/g, '$1キロ')
      .replace(/(\d)\s*%/g, '$1パーセント')
  );
}

function clean(text: string): string {
  return speakableNumbers(text.replace(DECORATION, '')).replace(/\s+/g, ' ').trim();
}

/** 文として途切れるよう、句点で終わらせる。 */
function sentence(text: string): string {
  const trimmed = clean(text);
  if (!trimmed) return '';
  return /[。．！？!?]$/.test(trimmed) ? trimmed : `${trimmed}。`;
}

function blockToSpeech(block: RichBlock): string {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return sentence(flatten(block.content));
    case 'bullets':
    case 'ordered':
      return block.items.map((item) => sentence(flatten(item))).filter(Boolean).join('');
    case 'menu': {
      const lines = [block.title ? sentence(block.title) : ''];
      for (const item of block.items) {
        lines.push(sentence([item.label, item.detail].filter(Boolean).join('、')));
      }
      if (block.note) lines.push(sentence(block.note));
      return lines.filter(Boolean).join('');
    }
    case 'zones': {
      const lines = [block.basis ? sentence(block.basis) : ''];
      for (const row of block.rows) {
        lines.push(sentence([row.name ?? row.zone, row.range, row.note].filter(Boolean).join('、')));
      }
      return lines.filter(Boolean).join('');
    }
    case 'gear':
      // 商品リンクは耳で聞いても選べない。画面を見るよう促すだけにする。
      return [block.note ? sentence(block.note) : '', '道具の候補を画面に出しています。']
        .filter(Boolean)
        .join('');
    case 'pending':
    default:
      return '';
  }
}

/** コーチの返答を、読み上げに渡せる文字列にする。 */
export function toSpokenText(text: string): string {
  return parseRichText(stripToolTextForDisplay(text))
    .map(blockToSpeech)
    .filter(Boolean)
    .join('')
    .trim();
}

/** この端末で読み上げが使えるか。 */
export function speechSynthesisAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** この端末で音声入力が使えるか。 */
export function speechRecognitionAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}
