/**
 * 走れない日の、その先。
 *
 * **ランナーがいちばん困るのは、痛くなった日。**
 * そして、どのランニングアプリもそこを埋めていない。時計は痛くても普通にメニューを出すし、
 * 記録アプリは走らない日を「空白」として扱う。
 *
 * このアプリは「痛みがある日は走らせない」とだけ言って、そこで終わっていた。
 * **止めるのは半分でしかない。** 止めた人が次に知りたいのは、この3つ。
 *
 *  1. 走れない間、代わりに何をすればいいのか
 *  2. いつ、どうやって走りに戻れるのか
 *  3. どうなったら病院へ行くべきなのか
 *
 * ## ここで絶対にやらないこと
 *
 * - **診断しない。** 「それは腸脛靭帯炎です」とは言わない。言えないし、言ってはいけない。
 *   やるのは、痛む場所から**負荷のかからない代わり**を選ぶことと、戻る順番を示すことだけ。
 * - **日数で戻さない。** 「2週間で戻れます」は言えない。戻る条件は日数ではなく、
 *   **痛みが出ないこと**。段ごとの条件だけを示す。
 * - **受診を遠ざけない。** 続くもの・腫れるもの・夜に痛むものは、はっきり病院へ送る。
 */

import type { PainPoint, RunnerProfile } from './types';
import { assessSafety } from './safety';
import { coachDate } from './day';

/** 痛む場所のおおまかな区分。**診断ではない。** 代わりの運動を選ぶためだけに使う。 */
export type PainArea = 'knee' | 'shin' | 'achilles' | 'calf' | 'foot' | 'hip' | 'thigh' | 'back' | 'other';

const AREA_WORDS: { area: PainArea; pattern: RegExp }[] = [
  { area: 'achilles', pattern: /アキレス/ },
  { area: 'shin', pattern: /すね|脛|シンスプ|脛骨/ },
  { area: 'calf', pattern: /ふくらはぎ|腓腹|ひらめ|こむら/ },
  { area: 'knee', pattern: /膝|ひざ|ヒザ|腸脛|鵞足/ },
  { area: 'foot', pattern: /足底|かかと|踵|足裏|土踏まず|中足|趾|つま先|足首|足関節/ },
  { area: 'hip', pattern: /股関節|臀|お尻|おしり|仙腸|鼠径/ },
  { area: 'thigh', pattern: /ハムスト|もも|大腿|四頭|内転/ },
  { area: 'back', pattern: /腰|背|脊/ },
];

/** 場所の言葉から区分を推し量る。分からなければ 'other'。**外れても害が出ない使い方しかしない。** */
export function areaOf(site: string): PainArea {
  const found = AREA_WORDS.find((entry) => entry.pattern.test(site));
  return found?.area ?? 'other';
}

export interface ComebackStep {
  label: string;
  detail: string;
  /** 図があるなら、その id（figures.ts）。 */
  figureId?: string;
}

export interface ComebackStage {
  /** 1から始まる段。 */
  step: number;
  title: string;
  /** この段でやること。 */
  what: string;
  /** 次へ上がってよい条件。**日数ではなく、痛みが出ないこと。** */
  next: string;
}

export interface ComebackPlan {
  sites: string[];
  area: PainArea;
  /** 痛みを訴えてから何日目か。分かる時だけ。 */
  daysSince?: number;
  /** 走らない間にやること。 */
  instead: ComebackStep[];
  /** 走りに戻るまでの段取り。 */
  stages: ComebackStage[];
  /** 病院を考える目安。 */
  seeDoctor: string[];
  note: string;
}

/**
 * 走らない間の代わり。
 *
 * **部位によって、やってはいけないものがある。**
 * アキレス腱に自転車を勧めると、こぎ方によってはそこを使い続けることになる。
 * 「何でもいいから有酸素を」は、いちばん無責任な助言。
 */
const INSTEAD: Record<PainArea, ComebackStep[]> = {
  knee: [
    { label: '水中を歩く', detail: '膝に体重がかからない。20〜30分、痛みの出ない範囲で' },
    { label: '自転車', detail: 'サドルを高めにして、軽いギアで。膝が深く曲がると痛む人は中止' },
    { label: 'お尻の補強', detail: '膝の痛みは、お尻が使えていない時に出やすい', figureId: 'strength-hip-lift' },
    { label: 'もも裏をゆるめる', detail: '痛む側も、反対側も', figureId: 'stretch-hamstring' },
  ],
  shin: [
    { label: 'まず休む', detail: 'すねの痛みは、押して一点が鋭く痛むなら骨の可能性がある。無理をしない' },
    { label: '水泳・水中歩行', detail: '地面を叩かない運動に替える' },
    { label: 'ふくらはぎをゆるめる', detail: '硬さがすねの張りに回ることが多い', figureId: 'stretch-calf' },
  ],
  achilles: [
    { label: '水泳・水中歩行', detail: 'つま先で蹴らない動きを選ぶ' },
    { label: '自転車は慎重に', detail: 'つま先側で踏むと腱を使う。かかと寄りで、軽いギアなら' },
    { label: 'ふくらはぎをゆるめる', detail: '伸ばして痛むなら、そこで止める', figureId: 'stretch-calf' },
    { label: '体幹', detail: '脚を使わずに積める', figureId: 'strength-plank' },
  ],
  calf: [
    { label: '水中歩行', detail: '地面を蹴らずに、脚を動かし続けられる' },
    { label: '自転車', detail: 'かかと寄りで、軽いギアで' },
    { label: 'ふくらはぎをゆるめる', detail: 'ゆっくり。反動をつけない', figureId: 'stretch-calf' },
  ],
  foot: [
    { label: '水泳・水中歩行', detail: '足裏に体重をかけずに動かす' },
    { label: '自転車', detail: '足裏への衝撃が無い' },
    { label: 'ふくらはぎをゆるめる', detail: 'ふくらはぎの硬さは、足裏の張りに直結する', figureId: 'stretch-calf' },
    { label: '体幹', detail: '脚を休ませたまま積める', figureId: 'strength-plank' },
  ],
  hip: [
    { label: '自転車', detail: '痛みの出ない可動域で、軽く' },
    { label: 'お尻の補強', detail: '弱さが原因のことが多い。痛みが出ない範囲で', figureId: 'strength-hip-lift' },
    { label: 'お尻をゆるめる', detail: '', figureId: 'stretch-glute' },
  ],
  thigh: [
    { label: '水中歩行', detail: '伸ばされる動きが少ない' },
    { label: '強く伸ばさない', detail: '肉離れの直後に伸ばすと長引く。痛みが引くまで待つ' },
    { label: '体幹', detail: '', figureId: 'strength-plank' },
  ],
  back: [
    { label: '歩く', detail: '痛みが出ない範囲で。座り続けるより良いことが多い' },
    { label: '体幹', detail: '腰は、支える力が足りない時に出やすい', figureId: 'strength-plank' },
    { label: '股関節の前をゆるめる', detail: '硬いと骨盤が前に倒れ、腰が反る', figureId: 'stretch-iliopsoas' },
  ],
  other: [
    { label: '痛みの出ない運動を選ぶ', detail: '水泳・水中歩行・自転車のうち、やってみて痛まないもの' },
    { label: '体幹', detail: '痛む場所を使わずに積める', figureId: 'strength-plank' },
  ],
};

/**
 * 走りに戻るまでの段取り。
 *
 * **日数で区切らない。** 「2週間休めば戻れる」は誰にも言えない。
 * 区切るのは、痛みが出ないこと。1段ずつ、痛みが出なければ次へ。
 */
const STAGES: ComebackStage[] = [
  {
    step: 1,
    title: 'まず、痛みを引かせる',
    what: '走らない。歩いて痛むなら、歩く距離も減らす。上の「代わりにやること」で体は動かしておく',
    next: '日常生活（歩く・階段）で痛みが出なくなったら、次へ',
  },
  {
    step: 2,
    title: '歩く',
    what: '30分、普通の速さで歩く。走らない',
    next: '歩いた日と、その翌日に痛みが出なければ、次へ',
  },
  {
    step: 3,
    title: '走と歩を混ぜる',
    what: '1分走って2分歩く、を6回（約18分）。走る部分はいちばん遅い速さで',
    next: '当日と翌日に痛みが出なければ、次へ。出たら1段戻る',
  },
  {
    step: 4,
    title: '続けて走る',
    what: '20〜30分、止まらずにゆっくり走る。距離もペースも見ない',
    next: 'これを2回、痛みなくできたら、次へ',
  },
  {
    step: 5,
    title: '量を戻す',
    what: '痛くなる前の週の半分から始めて、週ごとに戻していく。ポイント練習はいちばん最後',
    next: '元の量で2週間、痛みが出なければ、戻ったと考えてよい',
  },
];

/**
 * 1段上がるたびに守ること。
 * **画面に地の文として出す。** 記号は混ぜない（そのまま文字で見える）。
 */
export const LADDER_RULES = [
  '1段上がったら、1日空ける。続けて上げない',
  '痛みが出たら、1段戻る。戻るのは失敗ではなく、順番どおり',
  '走っている最中に痛みが出たら、その場で止める。「あと少し」で長引く',
];

/** 病院を考える目安。**ここは短くはっきり。** */
const SEE_DOCTOR = [
  '2週間たっても良くならない',
  '腫れている、熱を持っている',
  '夜、寝ている時に痛む',
  '歩くだけで痛む',
  '一点を押すと、鋭く痛む（骨に来ている可能性があります）',
  '日ごとに悪くなっている',
];

function daysBetween(from: string | undefined, now: Date): number | undefined {
  if (!from) return undefined;
  const at = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const today = Date.parse(`${coachDate(now)}T00:00:00Z`);
  if (Number.isNaN(at) || Number.isNaN(today)) return undefined;
  return Math.max(0, Math.round((today - at) / 86_400_000));
}

/** いちばん重い痛みを、代表として使う。 */
function leading(pains: PainPoint[]): PainPoint | undefined {
  return [...pains].sort((a, b) => b.severity - a.severity)[0];
}

/**
 * 走れない人のための段取り。走れるなら null。
 */
export function comebackPlan(profile: RunnerProfile, now: Date = new Date()): ComebackPlan | null {
  const safety = assessSafety(profile, now);
  if (!safety.runningForbidden) return null;

  const pains = safety.activePains;
  const main = leading(pains);
  const area = main ? areaOf(main.site) : 'other';
  const daysSince = daysBetween(main?.since, now);

  const note =
    daysSince !== undefined && daysSince >= 14
      ? '2週間を超えています。一度みてもらう価値があります。走れる体を残すための受診です。'
      : '痛みが引くまでの間も、やれることはあります。ここで積んだものは、戻った時に効きます。';

  return {
    sites: pains.map((pain) => pain.site),
    area,
    daysSince,
    instead: INSTEAD[area],
    stages: STAGES,
    seeDoctor: SEE_DOCTOR,
    note,
  };
}

/**
 * プロンプトに差し込む、走れない間の段取り。
 *
 * **画面に出ている段取りと、コーチの言うことを食い違わせない。**
 * 痛い時にばらばらのことを言われるのが、いちばん不安になる。
 */
export function comebackDoctrine(profile: RunnerProfile, now: Date = new Date()): string | null {
  const plan = comebackPlan(profile, now);
  if (!plan) return null;

  const lines = [
    '# 画面に出ている「走れない間の段取り」（**本人はもう見ている**）',
    `- 痛む場所: ${plan.sites.join('・')}${plan.daysSince !== undefined ? `（${plan.daysSince}日目）` : ''}`,
    `- 代わりにやること: ${plan.instead.map((item) => item.label).join('・')}`,
    `- 戻り方は5段。${plan.stages.map((stage) => `${stage.step}.${stage.title}`).join(' → ')}`,
    '- **日数で「いつ戻れる」と言わないこと。** 画面にも書いていない。戻る条件は痛みが出ないことだけ。',
    '- **診断しないこと。** 病名を言わない。やるのは、代わりの運動と順番を示すことだけ。',
    '- 受診の目安（2週間・腫れ・夜間痛・歩行時痛・一点の鋭い痛み・悪化）に当てはまるなら、',
    '  **はっきり病院を勧めること。** 遠ざけない。',
  ];
  if (plan.daysSince !== undefined && plan.daysSince >= 14) {
    lines.push('- **すでに2週間を超えている。** 今日の会話で一度は受診に触れること。');
  }
  return lines.join('\n');
}
