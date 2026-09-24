/**
 * 「この人には、どういう条件の道具が要るのか」を計算する層。
 *
 * 道具の相談がふわっとしたままになるのは、
 * カテゴリ（シューズ、ジェル）の話で止まってしまうからです。
 * 本当に知りたいのは「**自分の場合は**どれを、何本、いつまでに」であって、
 * それはカルテの数字（体重・週の走行距離・故障歴・ピッチ・本番までの日数・目標タイム）から
 * ほとんど決まります。
 *
 * ここではその条件だけを出します。商品を選ぶのは catalog.ts（実在する候補の取得）と
 * モデル（候補の中から、この人に合うものを選ぶ）の仕事です。
 * **条件の計算をモデルにやらせない。** 数字の話は、毎回同じ答えが出るべきものなので。
 */

import type { RaceEntry, RunnerProfile } from './types';
import { GEAR_CATEGORIES } from './gear';
import { MARATHON_KM, marathonPaceSeconds, parseDuration } from './goals';
import { daysUntil, targetRace } from './races';

export interface GearSpec {
  categoryId: string;
  title: string;
  /** この人の体と練習から決まる条件。買う前に満たしていてほしい線。 */
  requirements: string[];
  /** モールでの検索語。カテゴリの一般語に、この人の条件を足したもの。 */
  query: string;
  /** 「6本」など、計算で出る具体的な数量。 */
  quantity?: string;
  /** なぜ今なのか。本番までの日数から決まる。 */
  timing?: string;
  /** 買わなくてよい場合。必ず一つ持たせる。売るのが目的ではないので。 */
  skipIf: string;
}

/** ジェル1本あたりの糖質。国内で手に入る主なものはおよそこの量。 */
const GEL_CARB_G = 25;

/** レース中の補給の下限。指導の土台と同じ 1時間あたり60g を基準にする。 */
const CARBS_PER_HOUR = 60;

/** カフェインの上限の目安（体重1kgあたりmg）。これを超えると手が震え、胃が動かなくなる。 */
const CAFFEINE_MG_PER_KG = 3;

function injuryText(profile: RunnerProfile): string {
  return [
    ...(profile.injuryHistory ?? []),
    ...profile.pains.filter((pain) => pain.status !== 'resolved').map((pain) => pain.site),
  ].join(' ');
}

/** 直近に記録されたピッチ。読み取れた回だけを見て、真ん中の値を取る。 */
export function recentCadence(profile: RunnerProfile): number | undefined {
  const values = profile.activities
    .map((activity) => activity.metrics?.cadence)
    .filter((cadence): cadence is number => typeof cadence === 'number' && cadence > 100 && cadence < 260)
    .slice(-10)
    .sort((a, b) => a - b);
  if (values.length === 0) return undefined;
  return Math.round(values[Math.floor(values.length / 2)]);
}

/**
 * 大会の距離。表記が「フル」でも「42.195km」でも読めるようにする。
 * **ハーフを先に判定すること。** 「ハーフマラソン」は「マラソン」にも当たってしまう。
 */
export function raceDistanceKm(race: RaceEntry | undefined): number | undefined {
  if (!race) return undefined;
  const text = `${race.distance ?? ''} ${race.name ?? ''}`.toLowerCase();
  if (/ウルトラ|ultra|100k/.test(text)) return 100;
  if (/ハーフ|half|21\.1|21km/.test(text)) return 21.0975;
  if (/フル|full|42|marathon|マラソン/.test(text)) return MARATHON_KM;
  const match = /(\d+(?:\.\d+)?)\s*km/.exec(text);
  if (match) {
    const km = Number(match[1]);
    if (km > 0 && km <= 300) return km;
  }
  return undefined;
}

export interface FuelPlan {
  raceName?: string;
  distanceKm?: number;
  /** 想定所要時間（分）。 */
  minutes: number;
  carbsPerHour: number;
  /** 必要な糖質の総量(g)。 */
  totalCarbs: number;
  /** エイドの飲み物で賄える分(g)。差し引いた残りをジェルで持つ。 */
  drinkCarbs: number;
  /** 持っていくジェルの本数。 */
  gels: number;
  /** カフェインの上限(mg)。体重が分からなければ undefined。 */
  caffeineCapMg?: number;
  /** 何分おきに1本か。 */
  intervalMin: number;
  /** 想定時間をどうやって出したか。推定なら、推定だと言えるようにしておく。 */
  basis: string;
}

/**
 * 本番の補給計画。
 *
 * 「ジェルは何本持てばいいですか」に一般論で答えても意味がありません。
 * 必要な量は **走っている時間** で決まり、時間は目標タイムで決まります。
 */
export function fuelPlanFor(profile: RunnerProfile, now: Date = new Date()): FuelPlan | null {
  const race = targetRace(profile, now);
  const distanceKm = raceDistanceKm(race);

  let seconds = parseDuration(race?.targetTime);
  let basis = race?.targetTime ? `${race?.name ?? '本番'}の目標タイム ${race?.targetTime}` : '';

  if (seconds === undefined) {
    const goalSeconds = parseDuration(profile.goal?.targetTime);
    if (goalSeconds !== undefined && distanceKm !== undefined) {
      if (Math.abs(distanceKm - MARATHON_KM) < 1) {
        seconds = goalSeconds;
        basis = `目標タイム ${profile.goal?.targetTime}`;
      } else {
        const pace = marathonPaceSeconds(profile.goal?.targetTime);
        if (pace !== undefined) {
          seconds = pace * distanceKm;
          basis = `目標ペースから ${distanceKm.toFixed(distanceKm < 10 ? 1 : 0)}km 分を推定`;
        }
      }
    } else if (goalSeconds !== undefined) {
      seconds = goalSeconds;
      basis = `目標タイム ${profile.goal?.targetTime}（距離はフルマラソンとして）`;
    }
  }

  if (seconds === undefined || seconds <= 0) return null;

  const minutes = Math.round(seconds / 60);
  // 1時間半に満たない運動は、体に入っている糖質でほぼ足りる。
  if (minutes < 90) return null;

  const hours = minutes / 60;
  const totalCarbs = Math.round(hours * CARBS_PER_HOUR);
  // エイドのスポーツドリンクでも糖質は入る。全部をジェルで持つ前提は重すぎる。
  const drinkCarbs = Math.round(Math.min(totalCarbs * 0.3, hours * 20));
  const gels = Math.max(1, Math.ceil((totalCarbs - drinkCarbs) / GEL_CARB_G));

  return {
    raceName: race?.name,
    distanceKm,
    minutes,
    carbsPerHour: CARBS_PER_HOUR,
    totalCarbs,
    drinkCarbs,
    gels,
    caffeineCapMg:
      profile.bodyWeightKg !== undefined
        ? Math.round(profile.bodyWeightKg * CAFFEINE_MG_PER_KG)
        : undefined,
    intervalMin: Math.max(20, Math.round(minutes / (gels + 1) / 5) * 5),
    basis,
  };
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}時間${`${m}`.padStart(2, '0')}分` : `${m}分`;
}

/** 本番までの日数。Aレースが無ければ undefined。 */
function daysToRace(profile: RunnerProfile, now: Date): number | undefined {
  const race = targetRace(profile, now);
  return race ? daysUntil(race.date, now) : undefined;
}

function shoeBase(profile: RunnerProfile): { requirements: string[]; terms: string[] } {
  const requirements: string[] = [];
  const terms: string[] = [];
  const injuries = injuryText(profile);
  const weight = profile.bodyWeightKg;
  const cadence = recentCadence(profile);

  if (weight !== undefined) {
    if (weight >= 70) {
      requirements.push(`体重${weight}kg。着地の衝撃が大きいので、ミッドソールは厚めのもの（かかと35mm前後）`);
      terms.push('クッション');
    } else if (weight <= 52) {
      requirements.push(`体重${weight}kg。厚く硬いソールは沈まず、反発が返ってこない。軽量寄りでよい`);
    }
  }

  if (/足底|アキレス/.test(injuries)) {
    requirements.push('ドロップ（かかとと前足部の高低差）8mm以上。低ドロップはアキレス腱と足底への張力を増やす');
  }
  if (/膝|腸脛|ITB/.test(injuries)) {
    requirements.push('柔らかすぎるクッションは避ける。沈み込むと膝が内へ入りやすく、外側の張りが再発しやすい');
  }
  if (/シンスプリント|脛|すね/.test(injuries)) {
    requirements.push('前足部が硬く曲がらないものは避ける。脛の前面に負担が集まる');
  }
  if (/外反母趾|マメ|靴擦れ|爪/.test(injuries)) {
    requirements.push('足幅はワイド（2E〜3E）を基準に。幅が合っていないと、どんな名品でも痛める');
    terms.push('ワイド');
  }

  if (cadence !== undefined && cadence < 170) {
    requirements.push(
      `ピッチ${cadence}spm。1歩あたりの接地衝撃が大きい側なので、クッション量を優先する（ピッチを上げる練習と並行）`,
    );
    if (!terms.includes('クッション')) terms.push('クッション');
  }

  return { requirements, terms };
}

function dailyShoeSpec(profile: RunnerProfile): Omit<GearSpec, 'categoryId' | 'title'> {
  const { requirements, terms } = shoeBase(profile);
  const weekly = profile.weeklyVolumeKm;

  if (weekly !== undefined && weekly >= 50) {
    requirements.unshift(
      `週${weekly}km。1足で受け止める距離ではない。**2足を交互に履く**とミッドソールが1日休めるので、寿命も故障率も変わる`,
    );
    requirements.push('アウトソールのラバーが広く貼られた、耐久寄りのモデル');
  } else if (weekly !== undefined) {
    requirements.unshift(`週${weekly}km。まず1足を履き切ってよい範囲。買い替えの目安は500〜700km`);
  }

  return {
    requirements: requirements.length > 0 ? requirements : ['毎日の練習を受け止められる、クッションのあるモデル'],
    query: ['ランニングシューズ', ...terms].join(' '),
    skipIf: '今の靴がまだ500km以下で、痛みもマメも出ていないなら、買い替えはまだ先でよい',
  };
}

function raceShoeSpec(profile: RunnerProfile, now: Date): Omit<GearSpec, 'categoryId' | 'title'> {
  const { requirements, terms } = shoeBase(profile);
  const pace = marathonPaceSeconds(profile.goal?.targetTime);
  const left = daysToRace(profile, now);

  if (pace !== undefined) {
    if (pace <= 255) {
      requirements.unshift('目標ペースが速い。カーボンプレート入りの厚底が、後半の失速幅をいちばん小さくする');
      terms.push('カーボン');
    } else if (pace <= 330) {
      requirements.unshift('カーボンプレート入り、または軽量レーシング。接地時間が短く保てる方を選ぶ');
      terms.push('カーボン');
    } else {
      requirements.unshift(
        '反発より、終盤まで脚が残ることを優先する。軽さだけで選ばず、クッションのある厚底レーシングを',
      );
      terms.push('厚底');
    }
  } else {
    requirements.unshift('目標タイムが決まると、反発寄りか保護寄りかが決まる。先に目標を決めるのが順番として早い');
  }

  let timing: string | undefined;
  if (left !== undefined) {
    if (left <= 21) {
      timing = `本番まであと${left}日。**ここから新しいレースシューズに変えるのは勧めない。** 慣らす時間が足りず、当日に足が持たない危険の方が大きい`;
    } else if (left <= 60) {
      timing = `本番まであと${left}日。今週中に決めて、レースペース走で最低3回は履いておく`;
    } else {
      timing = `本番まであと${left}日。急がなくてよい。専門期（本番8週前）に入るまでに手元にあれば間に合う`;
    }
  }

  return {
    requirements,
    query: ['ランニングシューズ レーシング', ...terms].join(' '),
    timing,
    skipIf: 'レースペースでの練習がまだ始まっていないなら、今は練習用シューズに回した方が効く',
  };
}

function gelSpec(profile: RunnerProfile, now: Date): Omit<GearSpec, 'categoryId' | 'title'> {
  const plan = fuelPlanFor(profile, now);
  const left = daysToRace(profile, now);
  const requirements: string[] = [];
  let quantity: string | undefined;

  if (plan) {
    requirements.push(
      `想定 ${formatMinutes(plan.minutes)}（${plan.basis}）。1時間あたり糖質${plan.carbsPerHour}gが下限`,
      `必要な糖質は合計${plan.totalCarbs}g。うち約${plan.drinkCarbs}gはエイドのスポーツドリンクで賄える前提`,
      `残りをジェルで持つと **${plan.gels}本**。目安は${plan.intervalMin}分おきに1本`,
    );
    quantity = `${plan.gels}本`;
    if (plan.caffeineCapMg !== undefined) {
      requirements.push(
        `カフェインは合計${plan.caffeineCapMg}mgまで（体重${profile.bodyWeightKg}kg × 3mg）。後半用に1〜2本だけカフェイン入りにする`,
      );
    } else {
      requirements.push('後半用にカフェイン入りを1〜2本。上限は体重1kgあたり3mgなので、体重が分かれば本数を詰められる');
    }
  } else {
    requirements.push('90分を超える練習とレースで必要になる。1時間あたり糖質60gが下限');
  }

  requirements.push('粘度と味は体質で合う合わないが大きい。**最初は同じ銘柄をまとめ買いせず、数種類を試す**');

  let timing: string | undefined;
  if (left !== undefined && left >= 0) {
    timing =
      left <= 14
        ? `本番まであと${left}日。**本番で初めて使うものを増やさない。** 今から試すなら、すでに使ったことのある銘柄だけにする`
        : `本番まであと${left}日。ロング走で最低2回は同じ銘柄・同じ間隔で試してから本番に持ち込む`;
  }

  return {
    requirements,
    query: 'エナジージェル マラソン 補給',
    quantity,
    timing,
    skipIf: '走る時間が90分未満なら要らない。水と、走る前の食事で足りる',
  };
}

function genericSpec(categoryId: string, profile: RunnerProfile): Omit<GearSpec, 'categoryId' | 'title'> {
  const injuries = injuryText(profile);
  const category = GEAR_CATEGORIES.find((entry) => entry.id === categoryId);
  const requirements: string[] = [];

  switch (categoryId) {
    case 'watch':
      requirements.push('GPSと光学式心拍の両方が載っていること。ラップごとのペースと心拍が後から見返せること');
      if (profile.maxHr === undefined) {
        requirements.push('最大心拍がまだ分かっていない。心拍が測れるようになると、練習の強度判断がまるごと変わる');
      }
      break;
    case 'hrm':
      requirements.push('胸ベルト式。インターバルのように心拍が急に動く練習では、手首の光学式とは精度が違う');
      requirements.push('時計と繋がる規格（ANT+ / Bluetooth）を確認すること');
      break;
    case 'scale':
      requirements.push('体重だけでなく体脂肪率と体水分が測れるもの。毎朝、同じ条件で乗れることの方が精度より大事');
      break;
    case 'socks':
      requirements.push(
        /マメ|靴擦れ/.test(injuries)
          ? 'マメが出ている。指同士が擦れないよう五本指、かつ足裏にクッションのあるもの'
          : '厚みとフィットが合っていること。縫い目が指に当たらないもの',
      );
      break;
    case 'care':
      requirements.push(
        injuries ? `張りが出やすいのは ${injuries}。そこに当てられる硬さ・形のもの` : '太ももと臀部に当てられる長さのもの',
      );
      break;
    default:
      if (category?.why) requirements.push(category.why);
  }

  return {
    requirements,
    query: category?.query ?? '',
    skipIf: '今の練習で困っていることが無いなら、買わなくてよい',
  };
}

/** このランナーにとっての、そのカテゴリの条件。 */
export function gearSpecFor(
  categoryId: string,
  profile: RunnerProfile,
  now: Date = new Date(),
): GearSpec | null {
  const category = GEAR_CATEGORIES.find((entry) => entry.id === categoryId);
  if (!category) return null;

  const body =
    categoryId === 'shoes-daily'
      ? dailyShoeSpec(profile)
      : categoryId === 'shoes-race'
        ? raceShoeSpec(profile, now)
        : categoryId === 'gels'
          ? gelSpec(profile, now)
          : genericSpec(categoryId, profile);

  return { categoryId, title: category.title, ...body };
}

/** 検索語。カテゴリの一般語に、この人の条件から来る語を足したもの。 */
export function gearQueryFor(
  categoryId: string,
  profile: RunnerProfile,
  extra?: string,
  now: Date = new Date(),
): string {
  const spec = gearSpecFor(categoryId, profile, now);
  const base = spec?.query || GEAR_CATEGORIES.find((entry) => entry.id === categoryId)?.query || '';
  const added = (extra ?? '').trim();
  return [base, added].filter(Boolean).join(' ').trim();
}

/**
 * プロンプトに差し込む、この人の補給計画。
 * 本数のような計算済みの数字は、モデルに計算し直させずそのまま使わせる。
 */
export function fuelDoctrine(profile: RunnerProfile, now: Date = new Date()): string | null {
  const plan = fuelPlanFor(profile, now);
  if (!plan) return null;

  return [
    '# この人の補給計画（計算済み。自分で計算し直さないこと）',
    `- 想定所要時間: ${formatMinutes(plan.minutes)}（${plan.basis}）`,
    `- 必要な糖質: 1時間あたり${plan.carbsPerHour}g、合計約${plan.totalCarbs}g`,
    `- エイドの飲み物で約${plan.drinkCarbs}g。**ジェルは${plan.gels}本**、${plan.intervalMin}分おきが目安`,
    plan.caffeineCapMg !== undefined
      ? `- カフェインの上限: ${plan.caffeineCapMg}mg。後半用に1〜2本まで`
      : '- カフェインの上限は体重1kgあたり3mg。体重が分かれば本数まで詰められる',
    '- 本番で初めて使わせない。ロング走で同じ銘柄・同じ間隔を試させること。',
  ].join('\n');
}
