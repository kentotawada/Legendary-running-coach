/**
 * 大会の公式記録を、ためる。
 *
 * **走った大会の記録は、いまアプリの中で「出た」としか残っていない。**
 * 練習は1本ずつ区間まで残るのに、1年かけて仕上げた1本が、名前と日付だけ。
 * 記録証は紙か PDF のまま、どこかのフォルダに沈んでいる。
 *
 * 時計のアプリが日々の練習を見るものだとすると、ここは**大会だけ**を見る。
 * 両方を同じ画面に混ぜない。性質がまるで違う。
 *
 *  - 練習は、**量と流れ**。1本の良し悪しより、積み上がりを見る
 *  - 大会は、**1本ずつが作品**。何年経っても、1本ごとに見返す
 *
 * ## ここで出す3つ
 *
 *  1. **5kmごとの通過**（記録証に載っているものを、そのまま並べる）
 *  2. **後半の落ち率**（前半と後半の1kmあたりの差を、%で）
 *  3. **自己ベストかどうか**（距離ごとに、自分の過去と比べて）
 *
 * ## やらないこと
 *
 * - **読み取った数字を、確かめずに入れない。** 写真から読む以上、
 *   桁の読み違いは必ず起きる。入れる前に、通過と完走が噛み合うかを見る。
 * - **無い数字を埋めない。** 気象は記録証に載っていなければ空のまま。
 *   「たぶんこれくらい」で埋めた気温は、翌年の判断を狂わせる。
 */

import type { RaceEntry, RaceResult, RunnerProfile } from './types';
import { formatDuration, formatPace } from './goals';
import { raceDistanceKm } from './gear-spec';

/** 1kmあたりの秒数として、あり得る幅。これを外れたら読み違い。 */
const MIN_PACE_SEC = 130;
const MAX_PACE_SEC = 1200;
/** 距離がこれだけ違えば、別の距離として扱う（自己ベストの比較）。 */
const SAME_DISTANCE_RATIO = 0.01;

/** 区間（通過と通過のあいだ）。 */
export interface RaceSegment {
  fromKm: number;
  toKm: number;
  km: number;
  sec: number;
  paceSec: number;
}

/**
 * 通過から、区間ごとに割り直す。
 *
 * 記録証に載っているのは**累積**なので、そのままでは「どこで落ちたか」が読めない。
 * 5km地点 25:00 / 10km地点 51:00 と並んでいても、
 * 後半5kmが26分だったことは、引き算するまで分からない。
 */
export function segmentsOf(result: RaceResult, distanceKm: number | undefined): RaceSegment[] {
  const splits = [...(result.splits ?? [])]
    .filter((split) => split.km > 0 && split.elapsedSec > 0)
    .sort((a, b) => a.km - b.km);

  const out: RaceSegment[] = [];
  let fromKm = 0;
  let fromSec = 0;

  for (const split of splits) {
    const km = Math.round((split.km - fromKm) * 1000) / 1000;
    const sec = split.elapsedSec - fromSec;
    if (km > 0 && sec > 0) {
      out.push({ fromKm, toKm: split.km, km, sec, paceSec: sec / km });
    }
    fromKm = split.km;
    fromSec = split.elapsedSec;
  }

  /*
    最後の区間。**ここを落とすと、マラソンの 40km〜ゴールが消える。**
    いちばん苦しい2.195km が、ちょうどそこにある。
  */
  if (distanceKm && distanceKm - fromKm > 0.05) {
    const km = Math.round((distanceKm - fromKm) * 1000) / 1000;
    const sec = result.finishSec - fromSec;
    if (sec > 0) out.push({ fromKm, toKm: distanceKm, km, sec, paceSec: sec / km });
  }

  return out;
}

export interface RaceFade {
  firstHalfPaceSec: number;
  secondHalfPaceSec: number;
  /** 後半 − 前半（秒/km）。プラスなら後半が遅い。 */
  deltaSec: number;
  /** 落ち率(%)。プラスなら後半が落ちている。 */
  percent: number;
  /** 後半のほうが速い（ネガティブスプリット）。 */
  negative: boolean;
}

/**
 * 後半の落ち率。
 *
 * **市民ランナーの大会は、ほぼ全部ここで決まる。**
 * 突っ込んで入って、30kmから落ちる。落ちた幅が全部タイムになる。
 *
 * 区間を本数で半分に割らない。**距離の真ん中で割る。**
 * 5km刻みのフルマラソンだと中間点（21.0975km）は 20〜25km の区間の中にあるので、
 * その区間は距離の比で前後に分ける。
 */
export function fadeOf(result: RaceResult, distanceKm: number | undefined): RaceFade | null {
  const segments = segmentsOf(result, distanceKm);
  if (segments.length < 2) return null;

  const total = segments.reduce((sum, segment) => sum + segment.km, 0);
  if (total <= 0) return null;
  const half = total / 2;

  let firstKm = 0;
  let firstSec = 0;
  let secondKm = 0;
  let secondSec = 0;
  let covered = 0;

  for (const segment of segments) {
    const start = covered;
    const end = covered + segment.km;
    covered = end;

    // 中間点をまたぐ区間は、距離の比で前後に分ける。
    const inFirst = Math.max(0, Math.min(end, half) - start);
    const inSecond = segment.km - inFirst;

    firstKm += inFirst;
    firstSec += segment.paceSec * inFirst;
    secondKm += inSecond;
    secondSec += segment.paceSec * inSecond;
  }

  if (firstKm <= 0 || secondKm <= 0) return null;

  const firstHalfPaceSec = firstSec / firstKm;
  const secondHalfPaceSec = secondSec / secondKm;
  const deltaSec = secondHalfPaceSec - firstHalfPaceSec;

  return {
    firstHalfPaceSec: Math.round(firstHalfPaceSec),
    secondHalfPaceSec: Math.round(secondHalfPaceSec),
    deltaSec: Math.round(deltaSec),
    percent: Math.round((deltaSec / firstHalfPaceSec) * 1000) / 10,
    negative: deltaSec < 0,
  };
}

/**
 * 読み取った記録が、噛み合っているか。
 *
 * **写真から読む以上、桁の読み違いは必ず起きる。**
 * 「1:52:30」が「52:30」になった記録を黙って入れると、
 * 自己ベストの一覧がそこで壊れて、以後ずっと直らない。
 *
 * 入れる前に、数字どうしが矛盾していないかだけを見る。
 * 中身の良し悪しは見ない。**通るか通らないかだけ。**
 */
export function validateResult(
  result: Pick<RaceResult, 'finishSec' | 'splits'>,
  distanceKm: number | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!(result.finishSec > 0)) {
    return { ok: false, reason: '完走タイムが読めていません。' };
  }

  if (distanceKm && distanceKm > 0) {
    const pace = result.finishSec / distanceKm;
    if (pace < MIN_PACE_SEC) {
      return {
        ok: false,
        reason: `完走タイム ${formatDuration(result.finishSec)} は ${distanceKm}km に対して速すぎます（1kmあたり ${formatPace(pace)}）。桁を読み違えていないか確かめてください。`,
      };
    }
    if (pace > MAX_PACE_SEC) {
      return {
        ok: false,
        reason: `完走タイム ${formatDuration(result.finishSec)} は ${distanceKm}km に対して遅すぎます（1kmあたり ${formatPace(pace)}）。時間の単位を取り違えていないか確かめてください。`,
      };
    }
  }

  const splits = [...(result.splits ?? [])].sort((a, b) => a.km - b.km);

  let prevKm = 0;
  let prevSec = 0;
  for (const split of splits) {
    if (!(split.km > 0) || !(split.elapsedSec > 0)) {
      return { ok: false, reason: '通過地点に、0 以下の値が混ざっています。' };
    }
    if (split.km <= prevKm) {
      return { ok: false, reason: `通過地点が ${prevKm}km のあとに ${split.km}km と、前に戻っています。` };
    }
    // 累積なので、必ず増える。減っていたら、区間タイムと取り違えている。
    if (split.elapsedSec <= prevSec) {
      return {
        ok: false,
        reason: `${split.km}km の通過 ${formatDuration(split.elapsedSec)} が、ひとつ前の通過より早くなっています。通過タイムは「スタートからの合計」で読んでください。`,
      };
    }

    const km = split.km - prevKm;
    const pace = (split.elapsedSec - prevSec) / km;
    if (pace < MIN_PACE_SEC || pace > MAX_PACE_SEC) {
      return {
        ok: false,
        reason: `${prevKm}km から ${split.km}km の区間が 1kmあたり ${formatPace(pace)} になります。読み違いの可能性があります。`,
      };
    }

    prevKm = split.km;
    prevSec = split.elapsedSec;
  }

  if (distanceKm && prevKm > distanceKm + 0.5) {
    return {
      ok: false,
      reason: `通過地点 ${prevKm}km が、大会の距離 ${distanceKm}km を超えています。`,
    };
  }
  if (prevSec > 0 && prevSec >= result.finishSec) {
    return {
      ok: false,
      reason: `最後の通過 ${formatDuration(prevSec)} が、完走タイム ${formatDuration(result.finishSec)} 以上になっています。`,
    };
  }

  return { ok: true };
}

/** 記録の入っている大会だけ、新しい順に。 */
export function finishedRaces(profile: RunnerProfile | null | undefined): RaceEntry[] {
  return (profile?.races ?? [])
    .filter((race) => race.result && race.result.finishSec > 0)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * 自己ベストか。
 *
 * **同じ距離の中だけで比べる。** ハーフのタイムをフルと並べない。
 * ネットとグロスは混ぜない……と言いたいところだが、片方しか載せない大会が多い。
 * **混ざり得ることを承知で比べる**ほうが、空欄だらけの一覧より役に立つ。
 */
export function isPersonalBest(
  race: RaceEntry,
  profile: RunnerProfile | null | undefined,
  now: Date = new Date(),
): boolean {
  const own = race.result?.finishSec;
  const km = raceDistanceKm(race);
  if (!own || !km) return false;

  for (const other of finishedRaces(profile)) {
    if (other.id === race.id) continue;
    // これから先の大会は、まだ比べる相手ではない。
    if (other.date > now.toISOString().slice(0, 10)) continue;
    const otherKm = raceDistanceKm(other);
    if (!otherKm) continue;
    if (Math.abs(otherKm - km) / km > SAME_DISTANCE_RATIO) continue;
    if ((other.result?.finishSec ?? Infinity) < own) return false;
  }
  return true;
}

/** 距離ごとの自己ベスト。メダルラックの見出しに出す。 */
export interface BestEntry {
  distanceKm: number;
  label: string;
  race: RaceEntry;
}

export function personalBests(profile: RunnerProfile | null | undefined): BestEntry[] {
  const byDistance = new Map<number, RaceEntry>();

  for (const race of finishedRaces(profile)) {
    const km = raceDistanceKm(race);
    if (!km) continue;
    // 0.01 刻みで丸めて、同じ距離をひとまとめにする。
    const key = Math.round(km * 100) / 100;
    const held = byDistance.get(key);
    if (!held || (race.result?.finishSec ?? Infinity) < (held.result?.finishSec ?? Infinity)) {
      byDistance.set(key, race);
    }
  }

  return [...byDistance.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([distanceKm, race]) => ({ distanceKm, label: distanceLabel(distanceKm), race }));
}

/** 距離の呼び名。42.195 を「42.195km」と書かない。 */
export function distanceLabel(km: number): string {
  if (Math.abs(km - 42.195) < 0.3) return 'フル';
  if (Math.abs(km - 21.0975) < 0.2) return 'ハーフ';
  if (km >= 80) return 'ウルトラ';
  return `${Math.round(km * 10) / 10}km`;
}

/** 「3時間28分41秒」ではなく「3:28:41」。記録証と同じ並びにする。 */
export function raceTime(seconds: number): string {
  return formatDuration(Math.round(seconds));
}

/**
 * プロンプトに差し込む、ためてある大会。
 *
 * **本人はもう画面で見ている。** 通過も落ち率も並んでいるので、
 * 読み上げ直されると「見れば分かることを言われた」になる。
 */
export function medalDoctrine(
  profile: RunnerProfile | null | undefined,
  now: Date = new Date(),
): string | null {
  const races = finishedRaces(profile);
  if (races.length === 0) return null;

  const lines = ['# 画面に出ている「走った大会」（**本人はもう見ている**）'];

  // 直近の5本まで。全部並べると、毎回の送信量がこれだけで膨らむ。
  for (const race of races.slice(0, 5)) {
    const km = raceDistanceKm(race);
    const fade = race.result ? fadeOf(race.result, km) : null;
    const best = isPersonalBest(race, profile, now) ? '（自己ベスト）' : '';
    const parts = [`- ${race.date} ${race.name} ${raceTime(race.result!.finishSec)}${best}`];
    if (fade) {
      parts.push(
        `  後半は前半より ${Math.abs(fade.percent)}% ${fade.negative ? '速い' : '遅い'}` +
          `（${formatPace(fade.firstHalfPaceSec)} → ${formatPace(fade.secondHalfPaceSec)}）`,
      );
    }
    if (race.result?.weather?.tempC !== undefined) {
      parts.push(`  当日の気温 ${race.result.weather.tempC}℃`);
    }
    lines.push(...parts);
  }

  const bests = personalBests(profile);
  if (bests.length > 0) {
    lines.push(
      `- 距離ごとの自己ベスト: ${bests
        .map((best) => `${best.label} ${raceTime(best.race.result!.finishSec)}`)
        .join(' / ')}`,
    );
  }

  lines.push(
    '- **数字を読み上げ直さないこと。** 画面に並んでいる。そこから何が言えるかだけを話す。',
    '- 落ち率は**こちらが計算済み**。自分で引き算し直さないこと。',
    '- 記録証の画像が来たら log_race_result を呼ぶ。**印字されていない項目は渡さない。**',
  );
  return lines.join('\n');
}
