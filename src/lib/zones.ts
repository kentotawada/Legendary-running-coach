import type { RunnerProfile } from './types';

/**
 * 心拍ゾーンの計算。
 *
 * ランナーが持っている数字は人によって違う。最大心拍だけの人、LTHRも知っている人、
 * 安静時心拍まで測っている人。どれであっても計算が止まらないよう、
 * 手持ちの情報でいちばん精度の高い方法を選ぶ。
 *
 * 精度順: LTHR基準 > 予備心拍(カルボーネン) > 最大心拍の割合
 */

export type ZoneBasis = 'lthr' | 'reserve' | 'max' | 'none';

export interface HeartRateZone {
  id: string;
  name: string;
  /** "142-152" のような bpm 範囲。 */
  range: string;
  /**
   * 範囲の下端・上端(bpm)。端のゾーンは片側が無い。
   * **文字列の range を読み直させない。** 走った心拍を振り分けるのに使う。
   */
  from?: number;
  to?: number;
  purpose: string;
}

export interface ZoneTable {
  basis: ZoneBasis;
  /** 何を根拠に計算したかの説明。 */
  basisLabel: string;
  /** 推定値を使った場合の断り書き。 */
  estimateNote?: string;
  zones: HeartRateZone[];
}

/** LTHR が未入力の時の推定値。最大心拍のおよそ89%。 */
export function estimateLthr(maxHr: number): number {
  return Math.round(maxHr * 0.89);
}

/** 年齢からの最大心拍の目安。本人が測っていない時の最後の手段。 */
export function estimateMaxHrFromAge(age: number): number {
  return 220 - age;
}

const ZONE_META = [
  { id: 'Z1', name: 'リカバリー', purpose: '回復走。積極的に休むための強度' },
  { id: 'Z2', name: 'イージー', purpose: '有酸素土台。週の大半をここで走る' },
  { id: 'Z3', name: 'マラソンペース', purpose: 'レースペース走。本番の再現' },
  { id: 'Z4', name: '閾値（T）', purpose: '乳酸閾値。20〜40分持続できる強度' },
  { id: 'Z5', name: 'VO2max（I）', purpose: '3〜5分の高強度。レース前の一時期のみ' },
];

/** LTHR基準（Friel）の境界。LTHRに対する割合。 */
const LTHR_BOUNDS = [0.81, 0.9, 0.94, 1.0];
/** 予備心拍（カルボーネン）の境界。 */
const RESERVE_BOUNDS = [0.6, 0.7, 0.8, 0.9];
/** 最大心拍の割合の境界。 */
const MAX_BOUNDS = [0.65, 0.75, 0.85, 0.92];

function toZones(bounds: number[], toBpm: (ratio: number) => number, ceiling: number): HeartRateZone[] {
  const edges = bounds.map(toBpm);
  return ZONE_META.map((meta, index) => {
    const from = index === 0 ? undefined : edges[index - 1];
    const to = index === ZONE_META.length - 1 ? undefined : edges[index] - 1;
    const range =
      from === undefined ? `〜${to}` : to === undefined ? `${from}〜${ceiling}` : `${from}〜${to}`;
    return { ...meta, range, from, to };
  });
}

/**
 * 手持ちの数字から心拍ゾーンを組み立てる。
 * 何も無ければ zones が空の表を返す。呼び出し側はそれを見て「尋ねる」判断ができる。
 */
export function heartRateZones(profile: RunnerProfile): ZoneTable {
  const { maxHr, lthr, restingHr } = profile;

  if (lthr !== undefined) {
    const ceiling = maxHr ?? Math.round(lthr * 1.12);
    return {
      basis: 'lthr',
      basisLabel: `LTHR ${lthr} bpm を基準に算出`,
      zones: toZones(LTHR_BOUNDS, (ratio) => Math.round(lthr * ratio), ceiling),
    };
  }

  if (maxHr !== undefined && restingHr !== undefined) {
    const reserve = maxHr - restingHr;
    return {
      basis: 'reserve',
      basisLabel: `予備心拍（最大 ${maxHr} − 安静時 ${restingHr}）を基準に算出`,
      estimateNote: `LTHR は未取得のため、推定値 ${estimateLthr(maxHr)} bpm（最大心拍の89%）を目安に使う。`,
      zones: toZones(RESERVE_BOUNDS, (ratio) => Math.round(restingHr + reserve * ratio), maxHr),
    };
  }

  if (maxHr !== undefined) {
    return {
      basis: 'max',
      basisLabel: `最大心拍 ${maxHr} bpm の割合で算出`,
      estimateNote:
        `LTHR と安静時心拍が未取得のため、LTHR は推定値 ${estimateLthr(maxHr)} bpm（最大心拍の89%）を目安に使う。` +
        '安静時心拍が分かれば、より正確な予備心拍ベースに切り替わる。',
      zones: toZones(MAX_BOUNDS, (ratio) => Math.round(maxHr * ratio), maxHr),
    };
  }

  return {
    basis: 'none',
    basisLabel: '最大心拍もLTHRも未取得',
    estimateNote:
      '心拍ゾーンの評価はできない。最大心拍を尋ねること（分からなければ「220−年齢」が目安だと伝える）。',
    zones: [],
  };
}

/** プロンプトに差し込む形。 */
export function zoneDoctrine(profile: RunnerProfile): string {
  const table = heartRateZones(profile);
  const lines = ['# この人の心拍ゾーン', `- 根拠: ${table.basisLabel}`];

  if (table.zones.length === 0) {
    lines.push(
      '- **心拍ゾーンの数値評価はできない。** 推測した心拍で語ってはならない。',
      '- 心拍の話が必要な場面では、最大心拍を尋ねる。分からない人には「220−年齢」が目安だと伝え、',
      '  時計やランニングアプリを使っているなら、レース中や全力走での最高値が参考になることも添える。',
    );
    return lines.join('\n');
  }

  for (const zone of table.zones) {
    lines.push(`- ${zone.id} ${zone.name}: ${zone.range} bpm — ${zone.purpose}`);
  }
  if (table.estimateNote) {
    lines.push(`- ${table.estimateNote}`);
    lines.push('- 推定値を使った時は、その旨を一言添えること。断定しない。');
  }
  return lines.join('\n');
}

/** ゾーンごとに、そこで走った時間。 */
export interface ZoneTime {
  zone: HeartRateZone;
  seconds: number;
  /** 走った時間全体に占める割合(0〜1)。 */
  ratio: number;
}

/**
 * 心拍ごとの秒数を、ゾーンに振り分ける。
 *
 * **記録のほうにゾーンを焼き込まない。** 最大心拍やLTHRは後から変わる。
 * 変わった時に過去の練習が古いゾーンのまま残ると、見比べが嘘になる。
 * 練習には「心拍ごとの秒数」だけを持たせ、ゾーンはその都度ここで当てる。
 */
export function timeInZones(
  hrSeconds: readonly (readonly [number, number])[] | undefined,
  zones: readonly HeartRateZone[],
): ZoneTime[] {
  if (!hrSeconds || hrSeconds.length === 0 || zones.length === 0) return [];

  const seconds = zones.map(() => 0);
  let total = 0;

  for (const [bpm, secs] of hrSeconds) {
    if (!(secs > 0)) continue;
    const index = zones.findIndex(
      (zone) => (zone.from === undefined || bpm >= zone.from) && (zone.to === undefined || bpm <= zone.to),
    );
    if (index < 0) continue;
    seconds[index] += secs;
    total += secs;
  }

  if (total <= 0) return [];
  return zones.map((zone, index) => ({
    zone,
    seconds: Math.round(seconds[index]),
    ratio: seconds[index] / total,
  }));
}
