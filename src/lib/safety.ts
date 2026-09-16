import type { PainPoint, RunnerProfile } from './types';

/**
 * 「少しでも痛みや違和感があれば、絶対に走らせない」を
 * プロンプトの言い回しではなくコードで担保するための層。
 *
 * モデルの出力は確率的なので、
 *  1. 走行禁止の指示をシステムプロンプトに機械的に差し込む（事前）
 *  2. 生成された文章に走行メニューが混ざっていないか検査する（事後）
 * の二段構えにしている。
 */

export interface SafetyAssessment {
  /** 1以上の痛みが未解消で残っているか。 */
  runningForbidden: boolean;
  activePains: PainPoint[];
  maxSeverity: number;
  /** システムプロンプトに差し込む強制ディレクティブ。 */
  directives: string[];
}

const STALE_PAIN_DAYS = 14;

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / 86_400_000);
}

export function assessSafety(profile: RunnerProfile, now: Date = new Date()): SafetyAssessment {
  const activePains = profile.pains.filter((p) => p.status !== 'resolved' && p.severity >= 1);
  const maxSeverity = activePains.reduce((max, p) => Math.max(max, p.severity), 0);
  const directives: string[] = [];

  if (activePains.length > 0) {
    const list = activePains
      .map((p) => `${p.site}（強さ ${p.severity}/5・${p.status === 'improving' ? '回復傾向' : '継続中'}）`)
      .join('、');

    directives.push(
      `【最優先・例外なし】このランナーは現在痛みを抱えている（${list}）。` +
        'ジョグ・ペース走・インターバル・ダッシュを含む、いかなる走行メニューも提案してはならない。' +
        '「軽く」「ゆっくり」「少しだけ」であっても走らせない。',
      '痛みの部位・発生タイミング・痛み方を丁寧にヒアリングし、着地位置や重心などフォーム面の仮説を1つだけ添えること。',
      '痛みに触れない代替トレーニング（体幹補強、上半身、痛みの出ない範囲のストレッチ、可動域づくり）と、' +
        '焦りを鎮めるメンタルケアをセットで提示すること。',
      '強い痛み・腫れ・しびれ・長期化の兆候があれば、整形外科やスポーツ外来の受診を具体的に勧めること。',
    );

    const stale = activePains.filter(
      (p) => daysBetween(now, new Date(p.updatedAt)) >= STALE_PAIN_DAYS,
    );
    if (stale.length > 0) {
      directives.push(
        `${stale.map((p) => p.site).join('、')}の痛みは記録から${STALE_PAIN_DAYS}日以上更新されていない。` +
          '今の状態を必ず質問し、update_pain で記録を更新すること。回復していれば status を resolved にする。',
      );
    }
  }

  return {
    runningForbidden: activePains.length > 0,
    activePains,
    maxSeverity,
    directives,
  };
}

/**
 * 走る系のメニューを指す語。
 * 「ラン」単体はバランス・ランチと衝突するため入れない。
 * 「流し」はウィンドスプリントの意味の時だけ拾いたいので、受け流し・聞き流し等を除外する。
 */
const RUNNING_TERMS =
  /(走る|走っ|走り|走ら|走ろ|ジョグ|ジョギング|ランニング|ペース走|インターバル|ビルドアップ|閾値走|坂ダッシュ|ダッシュ|LSD|ウィンドスプリント|キロ走|km走|(?<![けきいみにを])流し)/;

/** 提案・指示の言い回し。 */
const PRESCRIPTION_TERMS =
  /(ましょう|ませんか|してみて|してください|下さい|おすすめ|お勧め|オススメ|入れて|こなして|行って|やって|メニュー|プラン|予定)/;

/**
 * 否定・休養の言い回し。これがあれば「走らせていない」と判断する。
 * 「ず」は動詞の未然形に付く時だけ否定なので、「まず」「ずっと」を拾わないよう直前の音で絞る。
 * 「〜ませんか」は否定ではなく誘いなので、否定として数えない。
 */
const NEGATION_TERMS =
  /(ない|ません(?!か)|[らわえきかがさなせ]ず|やめ|止め|中止|控え|避け|休|禁止|NG|我慢|封印|お預け|代わり|代替|不可)/;

/**
 * 文章に「走る指示」が含まれているかを文単位で判定する。
 * 完全な自然言語理解ではなく、痛みがある時だけ走らせるミスを止めるための保険。
 */
export function containsRunningPrescription(text: string): boolean {
  const sentences = text.split(/[。．\n!！?？]/).map((s) => s.trim()).filter(Boolean);
  return sentences.some(
    (s) => RUNNING_TERMS.test(s) && PRESCRIPTION_TERMS.test(s) && !NEGATION_TERMS.test(s),
  );
}

/** 事後検査に引っかかった時に、もう一度だけ書き直させるための指示。 */
export const RUNNING_PRESCRIPTION_RETRY_DIRECTIVE =
  '【書き直し指示】直前の回答には走行メニューが含まれていた。' +
  'このランナーは痛みを抱えており、走らせることは許されない。' +
  '走る・ジョグ・ペース走・インターバル・ダッシュを一切含めず、' +
  '痛みのヒアリング、フォームの仮説、痛みに触れない代替トレーニング、' +
  'そして焦りを和らげる言葉だけで、同じ温かさで書き直すこと。';

/** 体の不調を訴える言い回し。届いた瞬間に慎重モードへ入るための先読み判定。 */
const DISCOMFORT_TERMS =
  /(痛|いた[いくみ]|イタ[イクミ]|違和感|張って|ハリがあ|しびれ|痺れ|腫れ|むくみ|怪我|ケガ|故障|肉離れ|捻挫|炎症|つっ?た|攣った)/;

export function mentionsDiscomfort(text: string): boolean {
  return DISCOMFORT_TERMS.test(text);
}
