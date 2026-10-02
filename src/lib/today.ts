/**
 * 今日やること。
 *
 * **このアプリでいちばん弱かったのは「開く理由」だった。**
 * 開くとチャットが出る。すでに Garmin か Strava を持っている人が、
 * その上でここを開く理由が、画面のどこにも無かった。
 *
 * 走る人が毎朝ほしいのは、分析でも履歴でもなく**「で、今日は何をするのか」**の一行。
 * それを、開いた瞬間に出す。
 *
 * ## 決め方の順番（上が強い）
 *
 *  1. **痛み** … 何があっても走らせない。ここは絶対に動かない
 *  2. **レース当日・直前** … 積む日ではない
 *  3. **コーチが決めた今日の予定** … 会話で決めたものが、いちばん本人に合っている
 *  4. **積みすぎ** … 増やすのを止める日
 *  5. **リズム** … 昨日までの並びから決める
 *
 * ## やらないこと
 *
 * - **モデルに毎朝考えさせない。** 1通¥4.32かかる上に、同じ日に開くたび
 *   違うことを言い出す。決まったことが毎回変わるのは、コーチではない。
 * - **決めつけない。** 出したあと必ず「きつい」「時間がない」で崩せるようにする。
 *   崩せない予定は、守れなかった日に**アプリを開かない理由**になる。
 */

import type { CoachPlan, PlanIntensity, RunnerProfile } from './types';
import { assessSafety } from './safety';
import { coachDate } from './day';
import { daysUntil, targetRace } from './races';
import { marathonPaceSeconds, resolveTargetPace, trainingPaces } from './goals';
import { workloadOf } from './workload';
import { heatAdvice, isFresh } from './weather';

/** 何を根拠に決めたか。画面には出さないが、言葉を選ぶのに使う。 */
export type TodaySource = 'pain' | 'race' | 'plan' | 'workload' | 'rhythm' | 'start';

/**
 * 朝に押してもらう、今日の体の感じ。
 *
 * **これが、時計に絶対できないこと。**
 * 心拍変動をいくら測っても、昨日の残業も、子どもの夜泣きも、出張の移動も分からない。
 * ここまで記録からしか決めていなかったので、寝不足の日も同じものが出ていた。
 *
 * 聞くのは**1つだけ**。朝に3つも4つも押させたら、誰も押さなくなる。
 */
export const CONDITIONS = [
  { id: 'light', label: '軽い', fatigue: 1 },
  { id: 'normal', label: 'ふつう', fatigue: 2 },
  { id: 'heavy', label: '重い', fatigue: 4 },
] as const;

export type ConditionId = (typeof CONDITIONS)[number]['id'];

/** 「重い」と言える境目。 */
const HEAVY_FATIGUE = 4;
/** 「軽い」と言える境目。 */
const LIGHT_FATIGUE = 1;

export interface TodayStep {
  label: string;
  detail?: string;
}

export interface TodayPlan {
  intensity: PlanIntensity;
  /** 今日の空気についての一言。取れていない日は無い。 */
  weather?: { headline: string; detail: string; level: string };
  source: TodaySource;
  /** 帯に出る一行。**ここだけで意味が通ること。** */
  headline: string;
  /** 補足の一行（ペースや時間）。 */
  summary?: string;
  /** なぜ今日それなのか。**ここが、他のアプリに無い部分。** */
  why: string;
  steps: TodayStep[];
  /** 「時間が無い」「きつい」に、先に答えておく。 */
  alternatives: { when: string; what: string }[];
  /** 走る予定かどうか。痛みの日は false。 */
  running: boolean;
}

const DAY_MS = 86_400_000;

/**
 * 走った記録を、1本でも持っているか。
 *
 * **持っていない人に、距離を断定してはいけない。**
 * その人のことを何も知らないのに「イージー6km」と出すのは、
 * 作った側の都合でしかなく、見る人は一目で見抜く。
 */
export function hasRunHistory(profile: RunnerProfile): boolean {
  return (profile.activities ?? []).some(
    (activity) => activity.type === 'run' && (activity.distanceKm ?? 0) > 0,
  );
}

/** 今日、本人が押した体の感じ。押していなければ undefined。 */
export function todayFatigue(profile: RunnerProfile, now: Date = new Date()): number | undefined {
  const today = coachDate(now);
  return profile.conditionLogs?.find((log) => log.date === today)?.fatigue;
}

function dayIndex(date: string): number | undefined {
  const at = Date.parse(`${(date ?? '').slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(at) ? undefined : Math.round(at / DAY_MS);
}

/** 何日前の練習か。今日なら 0。走る人の地域の日付で数える。 */
function daysAgo(date: string, now: Date): number | undefined {
  const at = dayIndex(date);
  const today = dayIndex(coachDate(now));
  if (at === undefined || today === undefined) return undefined;
  return today - at;
}

interface RecentRun {
  daysAgo: number;
  km: number;
  /** 本人かコーチが「ポイント練習」と呼んでいるか。 */
  hard: boolean;
}

/** ポイント練習らしさ。名前が付いていれば、それが答え。 */
const POINT_WORDS = /閾値|インターバル|ビルドアップ|ペース走|レース|テンポ|ヤッソ|坂|TT|タイムトライアル/;

function recentRuns(profile: RunnerProfile, now: Date): RecentRun[] {
  const runs: RecentRun[] = [];
  for (const activity of profile.activities ?? []) {
    if (activity.type !== 'run') continue;
    const ago = daysAgo(activity.date, now);
    if (ago === undefined || ago < 0 || ago > 10) continue;
    runs.push({
      daysAgo: ago,
      km: activity.distanceKm ?? 0,
      hard: POINT_WORDS.test(activity.session ?? ''),
    });
  }
  return runs.sort((a, b) => a.daysAgo - b.daysAgo);
}

/** イージーの言い方。目標が無い人にも、必ず言葉で基準を渡す。 */
function easyPaceText(profile: RunnerProfile): string {
  const marathonPace = marathonPaceSeconds(profile.goal?.targetTime);
  if (marathonPace === undefined) {
    const target = resolveTargetPace(profile.goal);
    return target ? `${target} より、はっきり遅く` : '鼻呼吸で会話できる速さで';
  }
  const paces = trainingPaces(marathonPace);
  return `${paces.easyFrom}〜${paces.easyTo}`;
}

/** いちばん長い練習の距離。戻す時の目安に使う。 */
function usualEasyKm(profile: RunnerProfile, now: Date): number {
  const runs = (profile.activities ?? []).filter((activity) => {
    if (activity.type !== 'run') return false;
    const ago = daysAgo(activity.date, now);
    return ago !== undefined && ago >= 0 && ago <= 28 && (activity.distanceKm ?? 0) > 0;
  });
  if (runs.length === 0) return 0;
  const sorted = runs.map((activity) => activity.distanceKm ?? 0).sort((a, b) => a - b);
  // 真ん中の値。いちばん長い日に引っ張られない。
  return Math.round(sorted[Math.floor(sorted.length / 2)]);
}

const REST: TodayStep[] = [
  { label: '歩く', detail: '20〜30分。息が上がらない範囲で' },
  { label: 'ストレッチ', detail: 'ふくらはぎ・もも裏・お尻を、各30秒ずつ' },
];

/** コーチが会話の中で決めた予定を、そのまま今日の形にする。 */
function fromPlan(plan: CoachPlan): TodayPlan {
  return {
    intensity: plan.intensity,
    source: 'plan',
    headline: plan.title,
    summary: plan.estimatedMinutes ? `${plan.estimatedMinutes}分` : undefined,
    why: plan.rationale,
    steps: plan.steps.map((step) => ({ label: step })),
    alternatives: plan.alternatives ?? [],
    running: plan.intensity !== 'rest',
  };
}

/**
 * 今日やること。
 *
 * **記録が1本も無い人にも、必ず何かを返す。** 「分かりません」は、
 * いちばん最初に開いた人にいちばん多く出ることになる。
 */
export function todayPlan(profile: RunnerProfile, now: Date = new Date()): TodayPlan {
  const base = basePlan(profile, now);
  const adjusted = adjustForCondition(base, todayFatigue(profile, now), usualEasyKm(profile, now) || 6);
  return withWeather(adjusted, profile, now);
}

/** 記録だけから決める、調整前の予定。 */
function basePlan(profile: RunnerProfile, now: Date): TodayPlan {
  const today = coachDate(now);

  // 1. 痛み。**ここは何があっても動かさない。**
  const safety = assessSafety(profile, now);
  if (safety.runningForbidden) {
    const sites = safety.activePains.map((pain) => pain.site).join('・');
    return {
      intensity: 'rest',
      source: 'pain',
      headline: '今日は走りません',
      summary: sites || undefined,
      why: sites
        ? `${sites}が残っています。痛みがあるうちは、走って良くなることはありません。` +
          '走れる体を残すほうが、1回の練習よりずっと大事です。'
        : '痛みが残っています。走って良くなることはありません。',
      steps: REST,
      alternatives: [
        { when: '体を動かしたい時', what: '痛みが出ない範囲で、自転車・水中歩行・上半身の補強' },
        { when: '2週間以上続いている時', what: '一度みてもらう。走れる体を残すための受診です' },
      ],
      running: false,
    };
  }

  // 2. レース。当日と直前は、積む日ではない。
  const race = targetRace(profile, now);
  const left = race ? daysUntil(race.date, now) : undefined;
  if (race && left === 0) {
    return {
      intensity: 'hard',
      source: 'race',
      headline: `${race.name}、いってらっしゃい`,
      summary: race.targetTime ? `目標 ${race.targetTime}` : undefined,
      why: '積んできたものは、今日の過ごし方では変わりません。前半を抑えて、最後まで自分のペースで。',
      steps: [
        { label: 'スタート前', detail: '20分前までに補給を済ませ、10分はゆっくり動いておく' },
        { label: '前半', detail: '目標ペースより少し遅いくらいで入る。周りに合わせない' },
        { label: '後半', detail: 'ここまで抑えた分が返ってきます' },
      ],
      alternatives: [{ when: '体調が良くない時', what: '記録より完走。無理だと思ったら止める判断も練習のうち' }],
      running: true,
    };
  }
  if (race && left !== undefined && left >= 1 && left <= 2) {
    return {
      intensity: 'easy',
      source: 'race',
      headline: `${race.name}まであと${left}日`,
      summary: '20〜30分 + 流し2〜3本',
      why:
        'ここから積んでも間に合いませんし、疲れだけが残ります。' +
        '体を眠らせないために、短く動かすだけにします。',
      steps: [
        { label: 'ジョグ', detail: `20〜30分 ${easyPaceText(profile)}` },
        { label: '流し', detail: '100m を2〜3本。速く走る感覚を戻すだけ' },
        { label: '持ち物の確認', detail: '新しい物は使わない。試した物だけで' },
      ],
      alternatives: [{ when: '脚が重い時', what: '完全に休んでよい。前日の休養で遅くなることはありません' }],
      running: true,
    };
  }

  // 3. コーチが会話の中で決めたもの。**本人と話して決めたものが、いちばん合っている。**
  const planned = (profile.plans ?? []).find((plan) => plan.date === today);
  if (planned) return fromPlan(planned);

  /*
    記録が1本も無い人。

    **ここで距離を断定しない。** その人がどのくらい走る人なのかを何も知らないのに
    「イージー6km」と出すのは、作った側の都合でしかない。
    週40km走る人には少なすぎ、これから始める人には多すぎる。どちらにも外れる。

    出すのは、**次にやれば中身が埋まる、ひとつのこと**だけ。
  */
  if (!hasRunHistory(profile)) {
    return {
      intensity: 'easy',
      source: 'start',
      headline: 'まず、1本おしえてください',
      why:
        'あなたがどのくらい走る人なのか、まだ分かりません。' +
        '知らないまま距離を決めても、多すぎるか少なすぎるかのどちらかになります。' +
        '1本入れば、次の日からは、あなたの記録に合わせて出します。',
      steps: [
        { label: '走った記録を送る', detail: '時計やアプリの画面を撮って送るだけ。1枚で足ります' },
        { label: 'つないでおく', detail: 'Strava をつなぐと、走り終えた記録がひとりでに届きます' },
        { label: '今日走るなら', detail: '会話できる速さで、気持ちよく終われる範囲で。距離は数えなくて大丈夫です' },
        { label: '過去の記録があるなら', detail: 'まとめて取り込めます。入れた分だけ、初日から中身が濃くなります' },
      ],
      // **初日に「できない日のために」は要らない。** まだ、できない予定が無い。
      alternatives: [],
      running: true,
    };
  }

  const easy = easyPaceText(profile);
  const runs = recentRuns(profile, now);
  const ranToday = runs.some((run) => run.daysAgo === 0);
  const yesterday = runs.find((run) => run.daysAgo === 1);
  const usual = usualEasyKm(profile, now) || 6;

  // 4. 積みすぎ。増やすのを止める日にする。
  const workload = workloadOf(profile, now);
  if (workload?.level === 'high') {
    return {
      intensity: 'easy',
      source: 'workload',
      headline: ranToday ? '今日はもう走っています' : '今日は増やさない日',
      summary: ranToday ? undefined : `${Math.max(4, Math.round(usual * 0.6))}km くらいまで`,
      why:
        `直近7日が${workload.acuteKm}km、直前4週の平均は1週あたり${workload.chronicKm}km。` +
        `${workload.ratio}倍の週になっています。故障が増えるのは、走った量そのものより「急に増えた時」です。`,
      steps: ranToday
        ? [{ label: '補給と睡眠', detail: '増えた週ほど、戻す時間が要ります' }, ...REST.slice(1)]
        : [
            { label: 'ジョグ', detail: `${Math.max(4, Math.round(usual * 0.6))}km ${easy}` },
            { label: 'ここで止める', detail: '物足りなさは、来週の貯金になります' },
          ],
      alternatives: [
        { when: '走りたくて仕方ない時', what: '時間を半分にして、ペースは上げない' },
        { when: '脚に張りがある時', what: '完全に休む。今週はもう十分に積んでいます' },
      ],
      running: !ranToday,
    };
  }

  // 5. リズム。昨日までの並びで決める。
  if (ranToday) {
    return {
      intensity: 'rest',
      source: 'rhythm',
      headline: '今日はもう走っています',
      why: '走った後にやることが、次の練習の質を決めます。食べて、寝る。それが今日の続きです。',
      steps: [
        { label: '補給', detail: '走り終えて30分以内に、炭水化物とたんぱく質を' },
        { label: 'ストレッチ', detail: 'ふくらはぎ・もも裏・お尻を、各30秒ずつ' },
      ],
      alternatives: [{ when: 'まだ動けそうな時', what: '補強を10分。走る量は増やさない' }],
      running: false,
    };
  }

  const quiet = runs.length === 0 ? undefined : runs[0].daysAgo;
  if (quiet !== undefined && quiet >= 5) {
    return {
      intensity: 'easy',
      source: 'rhythm',
      headline: '軽く、戻すところから',
      summary: `${Math.max(3, Math.round(usual * 0.5))}km くらい`,
      why:
        `${quiet}日ぶりです。空いた後の1本は、同じ距離でも脚への当たり方が違います。` +
        '物足りないくらいで止めておくと、明日もう一度走れます。',
      steps: [
        { label: 'ジョグ', detail: `${Math.max(3, Math.round(usual * 0.5))}km ${easy}` },
        { label: '歩いて終える', detail: '最後の5分は歩いてよい' },
      ],
      alternatives: [
        { when: '時間が取れない時', what: '15分だけでも外に出る。距離は数えなくていい' },
        { when: '気が乗らない時', what: '歩くだけでもスタンプは付きます' },
      ],
      running: true,
    };
  }

  if (yesterday?.hard || (yesterday && yesterday.km >= Math.max(15, usual * 1.6))) {
    return {
      intensity: 'easy',
      source: 'rhythm',
      headline: '今日は、脚を戻す日',
      summary: `${Math.max(4, Math.round(usual * 0.7))}km ${easy}`,
      why:
        `昨日は${yesterday.hard ? 'ポイント練習' : `${yesterday.km}km`}を走っています。` +
        '強くなるのは走っている時ではなく、その後に戻している時です。ここを速く走ると、昨日の分が消えます。',
      steps: [
        { label: 'ジョグ', detail: `${Math.max(4, Math.round(usual * 0.7))}km ${easy}` },
        { label: '遅いことを気にしない', detail: 'イージーが速すぎるのが、いちばん多い失敗です' },
      ],
      alternatives: [
        { when: '脚が重い時', what: '完全に休む。休むのも練習のうちです' },
        { when: '時間が取れない時', what: '20分だけ。距離は数えなくていい' },
      ],
      running: true,
    };
  }

  // 2日続けて走っているなら、3日目は休んでよい日として出す。
  if (runs.filter((run) => run.daysAgo <= 2).length >= 2) {
    return {
      intensity: 'easy',
      source: 'rhythm',
      headline: '休んでも、軽く走ってもいい日',
      summary: `走るなら ${Math.max(4, Math.round(usual * 0.8))}km ${easy}`,
      why: '2日続けて走っています。ここで休むか軽く流すかは、脚の感じで決めてよいところです。',
      steps: [
        { label: '脚を確かめる', detail: '階段を下りてみて、張りが強ければ今日は休む' },
        { label: '走るなら', detail: `${Math.max(4, Math.round(usual * 0.8))}km ${easy}` },
      ],
      alternatives: [{ when: '迷った時', what: '休む。1日休んで遅くなることはありません' }],
      running: true,
    };
  }

  return {
    intensity: 'easy',
    source: 'rhythm',
    headline: `イージー ${Math.max(4, usual)}km`,
    summary: easy,
    why:
      '週の8割はこの強度です。ここを速く走ってしまうのが、いちばん多い失敗。' +
      '遅く走れる日が、速く走れる日をつくります。',
    steps: [
      { label: 'ジョグ', detail: `${Math.max(4, usual)}km ${easy}` },
      { label: '会話できる強さで', detail: '鼻で息ができる範囲。息が上がったら落とす' },
    ],
    alternatives: [
      { when: '時間が取れない時', what: '20分だけでいい。走らない日にしないことが大事です' },
      { when: '脚が重い時', what: '距離を半分に。ペースは上げない' },
    ],
    running: true,
  };
}

/**
 * 朝に押した体の感じで、組み直す。
 *
 * **押した意味が無いと、二度と押されない。**
 * 「重い」と言ったのに同じメニューが出ていたら、それはただのアンケートになる。
 *
 * ただし**痛みとレースには触らない。** あちらは体の感じより強い理由で決まっている。
 */
function adjustForCondition(plan: TodayPlan, fatigue: number | undefined, usual: number): TodayPlan {
  if (fatigue === undefined) return plan;
  if (plan.source === 'pain' || plan.source === 'race') return plan;
  if (!plan.running) return plan;

  if (fatigue >= HEAVY_FATIGUE) {
    const shorter = Math.max(3, Math.round(usual * 0.5));
    return {
      ...plan,
      intensity: 'easy',
      headline: plan.intensity === 'easy' ? '今日は、短めに' : '今日は軽くします',
      summary: `${shorter}km くらいまで`,
      why:
        '今朝、体が重いと押しています。' +
        (plan.intensity === 'easy'
          ? '重い日に距離を踏んでも、残るのは疲れだけです。短く切り上げて、明日につなげます。'
          : 'そこに強い練習を乗せると、効果より先に疲れが積みます。今日は軽い日に替えます。') +
        '（元の予定は「' + plan.headline + '」でした）',
      steps: [
        { label: 'ジョグ', detail: `${shorter}km。息が上がらない速さで` },
        { label: '途中でやめてよい', detail: '走り出して変わらなければ、そこで切り上げる' },
      ],
      alternatives: [
        { when: 'それでも重い時', what: '完全に休む。1日休んで遅くなることはありません' },
        { when: '3日続けて重い時', what: '疲れではなく、別の理由があるかもしれません。相談してください' },
      ],
    };
  }

  if (fatigue <= LIGHT_FATIGUE && plan.intensity === 'easy' && plan.source !== 'workload') {
    return {
      ...plan,
      why: `${plan.why}（今朝「体が軽い」と押しています。軽い日でも、イージーの日に距離は足しません。足すのは最後の流しだけです。）`,
      steps: [
        ...plan.steps,
        { label: '流し', detail: '100m を4本。速く走る感覚だけ戻す。距離は増やさない' },
      ],
    };
  }

  return plan;
}

/**
 * 今日の空気を足す。
 *
 * **走る前に言うから意味がある。** 走り終えてから「暑さの影響がありました」は、
 * 記録の説明にはなっても、判断には1秒も役に立たない。
 *
 * ペースそのものは書き換えない。**暑さは「落とす」話で、「やめる」話ではない。**
 * 書き換えると、涼しくなった時に元が何だったか分からなくなる。
 */
function withWeather(plan: TodayPlan, profile: RunnerProfile, now: Date): TodayPlan {
  if (!plan.running) return plan;
  if (!isFresh(profile.weather, now)) return plan;

  const marathonPace = marathonPaceSeconds(profile.goal?.targetTime);
  const easyPaceSec = marathonPace ? Math.round(marathonPace * 1.3) : undefined;
  const advice = heatAdvice(profile.weather!, easyPaceSec);
  if (advice.level === 'none') return plan;

  return {
    ...plan,
    weather: { headline: advice.headline, detail: advice.detail, level: advice.level },
    steps: [...plan.steps, { label: advice.headline, detail: advice.detail }],
  };
}

/** 帯に出す短い札。 */
export const INTENSITY_LABEL: Record<PlanIntensity, string> = {
  rest: '休養',
  easy: 'イージー',
  moderate: 'ポイント',
  hard: '本番',
};

/**
 * プロンプトに差し込む、今日の予定。
 *
 * **画面に出ているものと、コーチの言うことを食い違わせない。**
 * 開いた瞬間に「イージー8km」と書いてあるのに、聞いたら違うことを言うのは、
 * 二人のコーチがいるのと同じで、どちらも信用されなくなる。
 */
export function todayDoctrine(profile: RunnerProfile, now: Date = new Date()): string {
  const plan = todayPlan(profile, now);
  const lines = [
    '# 画面に出ている「今日やること」（**本人はもう見ている**）',
    `- ${plan.headline}${plan.summary ? `（${plan.summary}）` : ''}`,
    `- 理由として出している言葉: ${plan.why}`,
  ];

  if (plan.source === 'plan') {
    lines.push('- これは**あなたが会話の中で決めたもの**。覚えている前提で話すこと。');
  } else {
    lines.push(
      '- これは記録から自動で出したもの。**会話で決め直してよい。**',
      '  決め直したら `set_today_plan` で残すこと。残さないと、次に開いた時に元へ戻る。',
    );
  }

  if (plan.weather) {
    lines.push(
      `- 今日の空気: ${plan.weather.headline}`,
      `  ${plan.weather.detail}`,
      '- **目標ペースをそのまま勧めないこと。** 暑い日に同じ速度を求めるのは、ただきつくするだけ。',
      '  落としたぶんを「遅くなった」と数えないよう、ひとこと添えること。',
    );
  }

  const fatigue = todayFatigue(profile, now);
  if (fatigue !== undefined) {
    lines.push(
      fatigue >= HEAVY_FATIGUE
        ? '- **本人は今朝「体が重い」と押している。** それを踏まえて組み直した予定が上のもの。'
        : fatigue <= LIGHT_FATIGUE
          ? '- 本人は今朝「体が軽い」と押している。**それでも距離は足さない。** 足すのは流しだけ。'
          : '- 本人は今朝「ふつう」と押している。',
      '  **押した意味が無いと、二度と押されない。** 触れる時は、押した内容に沿って話すこと。',
    );
  } else {
    lines.push('- 今日の体の感じは、まだ押されていない。**催促はしない。** 聞くなら会話の流れで一度だけ。');
  }

  lines.push(
    '- **画面と違うことを言わない。** 変えるなら「変える」と言ってから変えること。',
    '  黙って別のことを言うと、コーチが二人いるのと同じになる。',
  );
  return lines.join('\n');
}
