/**
 * FIT ファイルを読む。
 *
 * Garmin の生の形式です。GPX / TCX には入らないものが、ここには入っています。
 * **上下動・接地時間・左右バランス・ランニングパワー。**
 * 走りのフォームに触れるには、この層が要ります。
 *
 * 独自の二進形式なので、自分で解きます。外部のライブラリは入れません。
 *
 * ## 間違えた時にいちばん危ないこと
 *
 * FIT は「何番の項目が何を意味するか」を、規格の表で決めています。
 * **番号を1つ取り違えると、別の意味の数値が、もっともらしい顔で入ってきます。**
 * 接地時間のつもりで歩幅が入る、といった事故です。
 * 数値そのものは正しく見えるので、後から気づけません。
 *
 * そこで、**取り出した値は必ず現実的な範囲で検めます**（`PLAUSIBLE`）。
 * 範囲を外れた値は、埋めずに捨てます。無い数字を作るより、無いままのほうが安全です。
 *
 * ## 区間ごとの値は、区間の記録から自分で計算します
 *
 * ラップの要約にも平均値は入っていますが、そちらの項目番号にも取り違えの危険があります。
 * 1秒ごとの記録（record）は項目番号が安定しているので、**そこから平均を出します。**
 */

import type { ActivityType } from './types';
import type { ImportedWorkout, WorkoutLap, WorkoutSample } from './workout';

/** FIT の時刻は 1989-12-31 00:00:00 UTC からの秒数。 */
const FIT_EPOCH_MS = 631_065_600_000;

/** 規格で決まっている項目の種類と、その大きさ（バイト）。 */
const BASE_SIZE = [1, 1, 1, 2, 2, 4, 4, 1, 4, 8, 1, 2, 4, 1, 8, 8, 8];

/** 「測れなかった」を表す値。そのまま数値として扱うと、とんでもない記録になる。 */
const INVALID: Record<number, number> = {
  0: 0xff,
  1: 0x7f,
  2: 0xff,
  3: 0x7fff,
  4: 0xffff,
  5: 0x7fffffff,
  6: 0xffffffff,
  10: 0,
  11: 0,
  12: 0,
  13: 0xff,
};

/** 走りとして現実的な範囲。ここを外れた値は、読み違えたものとして捨てる。 */
const PLAUSIBLE = {
  heartRate: [30, 240],
  /** 片脚の回転数(rpm)。spm に直すのは呼び出し側。 */
  cadence: [20, 130],
  /** 上下動(cm)。 */
  verticalOscillation: [3, 20],
  /** 接地時間(ms)。 */
  groundContact: [120, 450],
  /** 左右バランス（左の割合 %）。 */
  balance: [35, 65],
  /** ランニングパワー(W)。 */
  power: [30, 900],
  /** 上下動比(%)。 */
  verticalRatio: [3, 20],
  /** 歩幅(cm)。 */
  stepLength: [50, 250],
} as const;

function within(value: number | undefined, range: readonly [number, number]): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return value >= range[0] && value <= range[1] ? value : undefined;
}

/**
 * 中身を見て FIT かを判断する。
 * **名前は当てにならない。** 端末やアプリが拡張子を落とすことがある。
 * FIT は先頭から8バイト目に ".FIT" と書いてある。
 */
export function looksLikeFit(data: ArrayBuffer): boolean {
  if (data.byteLength < 12) return false;
  const view = new DataView(data);
  return (
    String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11)) ===
    '.FIT'
  );
}

export class FitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FitError';
  }
}

interface FieldDef {
  num: number;
  size: number;
  baseType: number;
}

interface MessageDef {
  global: number;
  littleEndian: boolean;
  fields: FieldDef[];
  /** 開発者が足した項目。中身は読まないが、大きさぶん進める必要がある。 */
  devSize: number;
}

/** 1つの項目を読む。並びの項目（size が種類より大きい）は、先頭だけを使う。 */
function readValue(
  view: DataView,
  offset: number,
  baseType: number,
  littleEndian: boolean,
): number | undefined {
  const type = baseType & 0x1f;
  let raw: number;

  switch (type) {
    case 0:
    case 2:
    case 10:
    case 13:
      raw = view.getUint8(offset);
      break;
    case 1:
      raw = view.getInt8(offset);
      break;
    case 3:
      raw = view.getInt16(offset, littleEndian);
      break;
    case 4:
    case 11:
      raw = view.getUint16(offset, littleEndian);
      break;
    case 5:
      raw = view.getInt32(offset, littleEndian);
      break;
    case 6:
    case 12:
      raw = view.getUint32(offset, littleEndian);
      break;
    case 8:
      raw = view.getFloat32(offset, littleEndian);
      break;
    case 9:
      raw = view.getFloat64(offset, littleEndian);
      break;
    default:
      // 文字列や 64bit は、この用途では使わない。
      return undefined;
  }

  return INVALID[type] !== undefined && raw === INVALID[type] ? undefined : raw;
}

/** 1秒ごとの記録。規格で番号が安定している項目だけを拾う。 */
interface FitRecord {
  /** UNIX 秒。 */
  ts: number;
  distanceM?: number;
  hr?: number;
  /** 片脚の回転数(rpm)。 */
  cadence?: number;
  speed?: number;
  altitudeM?: number;
  powerW?: number;
  verticalOscillationCm?: number;
  groundContactMs?: number;
  balanceLeft?: number;
  verticalRatio?: number;
  stepLengthCm?: number;
}

interface FitLap {
  startTs: number;
  elapsedSec?: number;
  distanceM?: number;
}

/** 種目。session の sport（1=ランニング, 11=ウォーキング）。 */
function sportOf(sport: number | undefined): ActivityType | undefined {
  if (sport === 1) return 'run';
  if (sport === 11) return 'walk';
  if (sport === undefined) return undefined;
  return 'cross';
}

interface Parsed {
  records: FitRecord[];
  laps: FitLap[];
  sport?: number;
}

function parseMessages(buffer: ArrayBuffer): Parsed {
  const view = new DataView(buffer);
  if (buffer.byteLength < 14) throw new FitError('FIT ファイルとして短すぎます。');

  const headerSize = view.getUint8(0);
  if (headerSize !== 12 && headerSize !== 14) {
    throw new FitError('FIT ファイルの形式が読み取れませんでした。');
  }
  const signature = String.fromCharCode(
    view.getUint8(8),
    view.getUint8(9),
    view.getUint8(10),
    view.getUint8(11),
  );
  if (signature !== '.FIT') throw new FitError('FIT ファイルではないようです。');

  const dataSize = view.getUint32(4, true);
  const end = Math.min(headerSize + dataSize, buffer.byteLength);

  const definitions = new Map<number, MessageDef>();
  const records: FitRecord[] = [];
  const laps: FitLap[] = [];
  let sport: number | undefined;
  let lastTimestamp = 0;

  let offset = headerSize;
  while (offset < end) {
    const header = view.getUint8(offset);
    offset += 1;

    // 圧縮時刻ヘッダ。下位5bitが前回からの差分になっている。
    const compressed = (header & 0x80) !== 0;
    const local = compressed ? (header >> 5) & 0x03 : header & 0x0f;

    if (!compressed && (header & 0x40) !== 0) {
      // 定義メッセージ。ここから先、この local 番号が何を意味するかが決まる。
      offset += 1; // 予約
      const littleEndian = view.getUint8(offset) === 0;
      offset += 1;
      const global = view.getUint16(offset, littleEndian);
      offset += 2;
      const count = view.getUint8(offset);
      offset += 1;

      const fields: FieldDef[] = [];
      for (let i = 0; i < count; i += 1) {
        fields.push({
          num: view.getUint8(offset),
          size: view.getUint8(offset + 1),
          baseType: view.getUint8(offset + 2),
        });
        offset += 3;
      }

      let devSize = 0;
      if ((header & 0x20) !== 0) {
        const devCount = view.getUint8(offset);
        offset += 1;
        for (let i = 0; i < devCount; i += 1) {
          devSize += view.getUint8(offset + 1);
          offset += 3;
        }
      }

      definitions.set(local, { global, littleEndian, fields, devSize });
      continue;
    }

    const def = definitions.get(local);
    if (!def) {
      // 定義を見ていない記録は、大きさが分からないので進めない。
      throw new FitError('FIT ファイルの並びが想定と違いました。');
    }

    const values = new Map<number, number>();
    for (const field of def.fields) {
      const value = readValue(view, offset, field.baseType, def.littleEndian);
      if (value !== undefined) values.set(field.num, value);
      offset += field.size;
    }
    offset += def.devSize;

    let timestamp = values.get(253);
    if (compressed && timestamp === undefined) {
      // 下位5bitだけを差し替える。ロールオーバーしたら32秒足す。
      const offsetBits = header & 0x1f;
      const rolled = (lastTimestamp & ~0x1f) + offsetBits;
      timestamp = rolled < lastTimestamp ? rolled + 0x20 : rolled;
    }
    if (timestamp !== undefined) lastTimestamp = timestamp;

    if (def.global === 20 && timestamp !== undefined) {
      // record
      const scaled = (num: number, scale: number, shift = 0) => {
        const raw = values.get(num);
        return raw === undefined ? undefined : raw / scale - shift;
      };
      const cadence = values.get(4);
      const fractional = values.get(53);

      records.push({
        ts: timestamp,
        distanceM: scaled(5, 100),
        hr: within(values.get(3), PLAUSIBLE.heartRate),
        cadence: within(
          cadence === undefined ? undefined : cadence + (fractional ?? 0) / 128,
          PLAUSIBLE.cadence,
        ),
        speed: scaled(73, 1000) ?? scaled(6, 1000),
        altitudeM: scaled(78, 5, 500) ?? scaled(2, 5, 500),
        powerW: within(values.get(7), PLAUSIBLE.power),
        // 規格では上下動はmm。cm に直してから検める。
        verticalOscillationCm: within(scaled(39, 100), PLAUSIBLE.verticalOscillation),
        groundContactMs: within(scaled(41, 10), PLAUSIBLE.groundContact),
        balanceLeft: within(scaled(84, 100), PLAUSIBLE.balance),
        verticalRatio: within(scaled(83, 100), PLAUSIBLE.verticalRatio),
        stepLengthCm: within(scaled(85, 100), PLAUSIBLE.stepLength),
      });
    } else if (def.global === 19) {
      // lap
      const start = values.get(2) ?? timestamp;
      if (start !== undefined) {
        const elapsed = values.get(7);
        const distance = values.get(9);
        laps.push({
          startTs: start,
          elapsedSec: elapsed === undefined ? undefined : elapsed / 1000,
          distanceM: distance === undefined ? undefined : distance / 100,
        });
      }
    } else if (def.global === 18) {
      // session
      sport = values.get(5) ?? sport;
    }
  }

  return { records, laps, sport };
}

/**
 * その地点のペース(秒/km)。
 *
 * 速度が入っていればそこから。**入っていない時計もある**ので、
 * 無ければ距離と時刻の差から出す。止まっている点はペースを持たせない
 * （分母が0に近づくと、とんでもない数字になる）。
 */
function paceOf(previous: FitRecord | undefined, record: FitRecord): number | undefined {
  const inRange = (pace: number) => (pace >= 120 && pace <= 1200 ? Math.round(pace) : undefined);

  if (record.speed !== undefined && record.speed > 0.5) return inRange(1000 / record.speed);
  if (!previous || previous.distanceM === undefined || record.distanceM === undefined) return undefined;

  const meters = record.distanceM - previous.distanceM;
  const seconds = record.ts - previous.ts;
  if (meters < 1 || seconds <= 0) return undefined;
  return inRange(seconds / (meters / 1000));
}

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** 区間の中身を、1秒ごとの記録から出す。ラップ要約の項目番号に頼らないため。 */
function summarize(records: FitRecord[]) {
  const pick = <K extends keyof FitRecord>(key: K) =>
    records.map((record) => record[key]).filter((value): value is number => typeof value === 'number');

  const hr = pick('hr');
  return {
    avgHr: mean(hr),
    maxHr: hr.length > 0 ? Math.max(...hr) : undefined,
    cadence: mean(pick('cadence')),
    powerW: mean(pick('powerW')),
    verticalOscillationCm: mean(pick('verticalOscillationCm')),
    groundContactMs: mean(pick('groundContactMs')),
    balanceLeft: mean(pick('balanceLeft')),
    verticalRatio: mean(pick('verticalRatio')),
    stepLengthCm: mean(pick('stepLengthCm')),
  };
}

const round = (value: number | undefined, digits = 1) =>
  value === undefined ? undefined : Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * FIT を、正規化された練習に直す。
 * 1つのファイルに練習は1本（Garmin の書き出しはそうなっている）。
 */
export function parseFit(buffer: ArrayBuffer): ImportedWorkout[] {
  const { records, laps, sport } = parseMessages(buffer);
  // **読めた中身を、そのまま理由にする。** 「見つかりません」だけでは、直しようがない。
  if (records.length < 2) {
    throw new FitError(
      `FIT は開けましたが、走っている間の記録が${records.length}点しかありませんでした。`,
    );
  }

  const first = records[0];
  const last = records[records.length - 1];
  const startedAt = new Date(first.ts * 1000 + FIT_EPOCH_MS).toISOString();

  const distances = records
    .map((record) => record.distanceM)
    .filter((value): value is number => typeof value === 'number');
  const distanceM = distances.length > 0 ? Math.max(...distances) - Math.min(...distances) : undefined;
  const durationSec = last.ts - first.ts;

  // 距離も時間も無い練習は、この先で黙って落ちる。**落ちる前に、何が足りないかを言う。**
  if (!(distanceM && distanceM > 0) && !(durationSec > 0)) {
    throw new FitError(
      `FIT は読めましたが、距離も時間も入っていませんでした（記録${records.length}点）。`,
    );
  }

  const overall = summarize(records);

  // ラップは開始時刻で区切る。境目の記録を取りこぼさないよう、終端は次のラップの手前まで。
  const lapList: WorkoutLap[] = [];
  for (const lap of laps) {
    const from = lap.startTs;
    const to = lap.elapsedSec !== undefined ? from + lap.elapsedSec : Number.POSITIVE_INFINITY;
    const inside = records.filter((record) => record.ts >= from && record.ts < to);
    if (inside.length < 2) continue;

    const insideDistances = inside
      .map((record) => record.distanceM)
      .filter((value): value is number => typeof value === 'number');
    const meters =
      lap.distanceM ??
      (insideDistances.length > 1 ? Math.max(...insideDistances) - Math.min(...insideDistances) : 0);
    const seconds = lap.elapsedSec ?? inside[inside.length - 1].ts - inside[0].ts;
    if (meters <= 0 || seconds <= 0) continue;

    const stats = summarize(inside);
    lapList.push({
      distanceM: meters,
      durationSec: seconds,
      avgHr: round(stats.avgHr, 0),
      maxHr: stats.maxHr,
      cadence: stats.cadence,
      powerW: round(stats.powerW, 0),
      verticalOscillationCm: round(stats.verticalOscillationCm),
      groundContactMs: round(stats.groundContactMs, 0),
      balanceLeft: round(stats.balanceLeft),
    });
  }

  const samples: WorkoutSample[] = records.map((record, index) => ({
    t: record.ts - first.ts,
    d: record.distanceM,
    hr: record.hr,
    cadence: record.cadence,
    pace: paceOf(records[index - 1], record),
    power: record.powerW,
    vo: record.verticalOscillationCm,
    gct: record.groundContactMs,
  }));

  return [
    {
      externalId: `file:${startedAt}`,
      startedAt,
      type: sportOf(sport) ?? 'run',
      distanceM: distanceM && distanceM > 0 ? Math.round(distanceM) : undefined,
      durationSec: durationSec > 0 ? durationSec : undefined,
      avgHr: round(overall.avgHr, 0),
      maxHr: overall.maxHr,
      cadence: overall.cadence,
      elevationGainM: elevationGain(records),
      source: 'file',
      laps: lapList.length > 1 ? lapList : undefined,
      samples,
      dynamics: {
        powerW: round(overall.powerW, 0),
        verticalOscillationCm: round(overall.verticalOscillationCm),
        groundContactMs: round(overall.groundContactMs, 0),
        balanceLeft: round(overall.balanceLeft),
        verticalRatio: round(overall.verticalRatio),
        stepLengthCm: round(overall.stepLengthCm, 0),
      },
    },
  ];
}

/** 気圧・GPS のぶれで標高は細かく上下する。1m 未満の変化は積まない。 */
function elevationGain(records: FitRecord[]): number | undefined {
  let gain = 0;
  let previous: number | undefined;
  for (const record of records) {
    if (record.altitudeM === undefined) continue;
    if (previous !== undefined && record.altitudeM - previous > 1) gain += record.altitudeM - previous;
    previous = record.altitudeM;
  }
  return gain > 0 ? Math.round(gain) : undefined;
}
