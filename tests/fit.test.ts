import { describe, expect, it } from 'vitest';
import { FitError, parseFit } from '@/lib/fit';
import { toActivity } from '@/lib/workout';
import { parseWorkoutFile } from '@/lib/workout-file';

/**
 * FIT を**書く**側をここで用意して、読む側を確かめる。
 *
 * 本物の Garmin のファイルはこの環境で手に入らない。
 * けれど FIT は規格で並びが決まっているので、規格どおりに組み立てたものを
 * 読ませれば、項目番号・単位・倍率の取り違えは、ここで捕まえられる。
 */

/** FIT の時刻は 1989-12-31 00:00:00 UTC からの秒数。 */
const FIT_EPOCH_MS = 631_065_600_000;
const fitTime = (iso: string) => Math.round((Date.parse(iso) - FIT_EPOCH_MS) / 1000);

const UINT8 = 0x02;
const UINT16 = 0x84;
const UINT32 = 0x86;

interface Field {
  num: number;
  type: number;
  value: number;
}

class FitWriter {
  private readonly data: number[] = [];

  u8(value: number) {
    this.data.push(value & 0xff);
  }
  u16(value: number) {
    this.data.push(value & 0xff, (value >> 8) & 0xff);
  }
  u32(value: number) {
    this.data.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff);
  }

  /** 定義メッセージ。ここから先、この local 番号が何を意味するかが決まる。 */
  define(local: number, global: number, fields: Field[]) {
    this.u8(0x40 | local);
    this.u8(0); // 予約
    this.u8(0); // little endian
    this.u16(global);
    this.u8(fields.length);
    for (const field of fields) {
      this.u8(field.num);
      this.u8(field.type === UINT8 ? 1 : field.type === UINT16 ? 2 : 4);
      this.u8(field.type);
    }
  }

  record(local: number, fields: Field[]) {
    this.u8(local);
    for (const field of fields) {
      if (field.type === UINT8) this.u8(field.value);
      else if (field.type === UINT16) this.u16(field.value);
      else this.u32(field.value);
    }
  }

  toBuffer(): ArrayBuffer {
    const header = [12, 0x20, 0x00, 0x00, 0, 0, 0, 0, 0x2e, 0x46, 0x49, 0x54];
    const size = this.data.length;
    header[4] = size & 0xff;
    header[5] = (size >> 8) & 0xff;
    header[6] = (size >> 16) & 0xff;
    header[7] = (size >>> 24) & 0xff;
    // 末尾の CRC は読む側で見ていないので、0 を置く。
    return new Uint8Array([...header, ...this.data, 0, 0]).buffer;
  }
}

const RECORD_FIELDS = [
  { num: 253, type: UINT32 }, // timestamp
  { num: 5, type: UINT32 }, // distance (×100 m)
  { num: 3, type: UINT8 }, // heart_rate
  { num: 4, type: UINT8 }, // cadence (片脚 rpm)
  { num: 7, type: UINT16 }, // power (W)
  { num: 39, type: UINT16 }, // vertical_oscillation (×10 mm)
  { num: 41, type: UINT16 }, // stance_time (×10 ms)
  { num: 84, type: UINT16 }, // stance_time_balance (×100 %)
  { num: 83, type: UINT16 }, // vertical_ratio (×100 %)
  { num: 85, type: UINT16 }, // step_length (×10 mm)
  { num: 78, type: UINT32 }, // enhanced_altitude (×5, −500 m)
];

interface LapSpec {
  seconds: number;
  meters: number;
  hrFrom: number;
  hrTo: number;
  cadence: number;
  power: number;
  /** 上下動(cm) */
  vo: number;
  /** 接地時間(ms) */
  gct: number;
  /** 左の割合(%) */
  balance: number;
}

const START = '2026-09-24T00:30:00.000Z';

function buildFit(laps: LapSpec[], sport = 1): ArrayBuffer {
  const writer = new FitWriter();
  const base = fitTime(START);

  writer.define(0, 20, RECORD_FIELDS.map((field) => ({ ...field, value: 0 })));

  let elapsed = 0;
  let distance = 0;
  const lapMarks: { start: number; seconds: number; meters: number }[] = [];

  for (const lap of laps) {
    lapMarks.push({ start: base + elapsed, seconds: lap.seconds, meters: lap.meters });
    const steps = lap.seconds / 10;
    for (let i = 0; i <= steps; i += 1) {
      const frac = i / steps;
      writer.record(0, [
        { num: 253, type: UINT32, value: base + elapsed + i * 10 },
        { num: 5, type: UINT32, value: Math.round((distance + lap.meters * frac) * 100) },
        { num: 3, type: UINT8, value: Math.round(lap.hrFrom + (lap.hrTo - lap.hrFrom) * frac) },
        { num: 4, type: UINT8, value: lap.cadence },
        { num: 7, type: UINT16, value: lap.power },
        { num: 39, type: UINT16, value: Math.round(lap.vo * 100) },
        { num: 41, type: UINT16, value: Math.round(lap.gct * 10) },
        { num: 84, type: UINT16, value: Math.round(lap.balance * 100) },
        { num: 83, type: UINT16, value: 720 },
        { num: 85, type: UINT16, value: 12000 },
        { num: 78, type: UINT32, value: (10 + 500) * 5 },
      ]);
    }
    elapsed += lap.seconds;
    distance += lap.meters;
  }

  writer.define(1, 19, [
    { num: 2, type: UINT32, value: 0 },
    { num: 7, type: UINT32, value: 0 },
    { num: 9, type: UINT32, value: 0 },
  ]);
  for (const mark of lapMarks) {
    writer.record(1, [
      { num: 2, type: UINT32, value: mark.start },
      { num: 7, type: UINT32, value: mark.seconds * 1000 },
      { num: 9, type: UINT32, value: mark.meters * 100 },
    ]);
  }

  writer.define(2, 18, [{ num: 5, type: UINT8, value: 0 }]);
  writer.record(2, [{ num: 5, type: UINT8, value: sport }]);

  return writer.toBuffer();
}

const LAPS: LapSpec[] = [
  { seconds: 600, meters: 2000, hrFrom: 150, hrTo: 160, cadence: 85, power: 280, vo: 9.5, gct: 240, balance: 49.8 },
  { seconds: 600, meters: 2000, hrFrom: 165, hrTo: 175, cadence: 88, power: 300, vo: 8.8, gct: 225, balance: 50.2 },
];

describe('FIT を読む', () => {
  const [workout] = parseFit(buildFit(LAPS));

  it('距離・時間・種目を取り出す', () => {
    expect(workout.type).toBe('run');
    expect(workout.distanceM).toBe(4000);
    expect(workout.durationSec).toBe(1200);
    expect(workout.startedAt).toBe(START);
  });

  /**
   * ここがこの層の本題。
   * **GPX にも TCX にも入らない数値**が、単位まで揃って出てくるか。
   */
  it('上下動・接地時間・左右バランス・パワーを、単位まで揃えて取り出す', () => {
    const dynamics = workout.dynamics!;
    // 上下動は規格では mm。cm に直っていること（9.5 と 8.8 の平均あたり）
    expect(dynamics.verticalOscillationCm!).toBeGreaterThan(9.0);
    expect(dynamics.verticalOscillationCm!).toBeLessThan(9.3);
    // 接地時間は ms
    expect(dynamics.groundContactMs!).toBeGreaterThan(230);
    expect(dynamics.groundContactMs!).toBeLessThan(235);
    // 左右バランスは %（50 が均等）
    expect(dynamics.balanceLeft!).toBeCloseTo(50, 0);
    expect(dynamics.powerW).toBe(290);
    expect(dynamics.verticalRatio).toBe(7.2);
    expect(dynamics.stepLengthCm).toBe(120);
  });

  it('区間ごとにも、フォームの数値が出る', () => {
    expect(workout.laps).toHaveLength(2);
    expect(workout.laps![0]).toMatchObject({ distanceM: 2000, durationSec: 600 });
    expect(workout.laps![0].verticalOscillationCm).toBeCloseTo(9.5, 1);
    expect(workout.laps![1].verticalOscillationCm).toBeCloseTo(8.8, 1);
    expect(workout.laps![0].groundContactMs).toBe(240);
    expect(workout.laps![1].powerW).toBe(300);
  });

  it('1秒ごとの推移も持って帰る', () => {
    expect(workout.samples!.length).toBeGreaterThan(100);
    expect(workout.samples![0].t).toBe(0);
    expect(workout.samples![0].hr).toBe(150);
  });

  it('カルテの記録に、フォームの数値が入る', () => {
    const activity = toActivity(workout)!;
    expect(activity.metrics?.groundContactMs).toBeGreaterThan(230);
    expect(activity.metrics?.powerW).toBe(290);
    // ピッチは片脚の回転数なので、spm に直っている
    expect(activity.metrics?.cadence).toBe(173);
    // 日本時間の朝9時30分の練習。前の日に入らない。
    expect(activity.date).toBe('2026-09-24');
  });
});

describe('読み違えを、そのまま入れない', () => {
  /**
   * 項目番号を1つ取り違えると、別の意味の数値がもっともらしい顔で入ってくる。
   * 数値自体は正しく見えるので、後から気づけない。だから範囲で弾く。
   */
  it('あり得ない接地時間は、捨てる', () => {
    const odd = buildFit([{ ...LAPS[0], gct: 5 }, { ...LAPS[1], gct: 5 }]);
    const [workout] = parseFit(odd);
    expect(workout.dynamics?.groundContactMs).toBeUndefined();
    // 他の数値は生き残る
    expect(workout.dynamics?.powerW).toBeGreaterThan(0);
  });

  it('あり得ない左右バランスは、捨てる', () => {
    const odd = buildFit([{ ...LAPS[0], balance: 5 }, { ...LAPS[1], balance: 5 }]);
    expect(parseFit(odd)[0].dynamics?.balanceLeft).toBeUndefined();
  });

  it('FIT でないファイルは、そう言う', () => {
    const notFit = new Uint8Array([12, 0x20, 0, 0, 0, 0, 0, 0, 0x41, 0x42, 0x43, 0x44]).buffer;
    expect(() => parseFit(notFit)).toThrow(FitError);
  });

  it('短すぎるファイルで落ちない', () => {
    expect(() => parseFit(new Uint8Array([1, 2, 3]).buffer)).toThrow(FitError);
  });
});

describe('取り込み口から見たとき', () => {
  it('拡張子が .fit なら、FIT として読む', () => {
    const workouts = parseWorkoutFile('12345.fit', buildFit(LAPS));
    expect(workouts).toHaveLength(1);
    expect(workouts[0].dynamics?.groundContactMs).toBeGreaterThan(0);
  });

  it('歩いた記録は、ランとして数えない', () => {
    const [workout] = parseFit(buildFit(LAPS, 11));
    expect(workout.type).toBe('walk');
  });
});

describe('読めなかった時に、何が足りなかったかを言う', () => {
  /**
   * **「見つかりませんでした」だけでは、直す場所が分からない。**
   * 開けたのか、記録が何点あったのか、何が入っていなかったのかまで言う。
   */
  const onlyTimestamps = (timestamps: number[]) => {
    const writer = new FitWriter();
    writer.define(0, 20, [{ num: 253, type: UINT32, value: 0 }]);
    for (const ts of timestamps) writer.record(0, [{ num: 253, type: UINT32, value: ts }]);
    return writer.toBuffer();
  };

  it('記録が足りない時は、その点数を言う', () => {
    const base = fitTime('2026-09-24T00:30:00.000Z');
    expect(() => parseFit(onlyTimestamps([base]))).toThrow(FitError);
    expect(() => parseFit(onlyTimestamps([base]))).toThrow(/1点/);
  });

  it('距離も時間も無い時は、そう言う', () => {
    // 時刻が動かない＝経過時間0。距離の項目も入っていない。
    const base = fitTime('2026-09-24T00:30:00.000Z');
    expect(() => parseFit(onlyTimestamps([base, base, base]))).toThrow(/距離も時間も/);
  });
});
