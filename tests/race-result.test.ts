import { describe, expect, it } from 'vitest';
import {
  distanceLabel,
  fadeOf,
  finishedRaces,
  isPersonalBest,
  personalBests,
  segmentsOf,
  validateResult,
} from '@/lib/race-result';
import { createDefaultProfile } from '@/lib/types';
import type { RaceEntry, RaceResult, RunnerProfile } from '@/lib/types';

/**
 * 大会の公式記録。
 *
 * ここで守りたいのは2つ。
 *  1. **読み取った数字を、確かめずに入れない。** 桁の読み違いは必ず起きる
 *  2. **最後の区間を落とさない。** フルの 40km〜ゴールが、いちばん苦しい
 */

const NOW = new Date('2026-10-02T12:00:00+09:00');
const MARATHON = 42.195;

/** 5kmごとの通過を、一定ペースで作る。 */
function evenSplits(paceSec: number, upToKm = 40) {
  const out = [];
  for (let km = 5; km <= upToKm; km += 5) out.push({ km, elapsedSec: Math.round(paceSec * km) });
  return out;
}

const resultOf = (extra: Partial<RaceResult> = {}): RaceResult => ({
  finishSec: 12_600,
  recordedAt: NOW.toISOString(),
  ...extra,
});

const raceOf = (extra: Partial<RaceEntry> = {}): RaceEntry => ({
  id: 'r1',
  name: '東京マラソン',
  date: '2026-03-01',
  distance: 'フル',
  priority: 'A',
  ...extra,
});

const profileOf = (races: RaceEntry[]): RunnerProfile => ({
  ...createDefaultProfile('u1', '2026-01-01T00:00:00.000Z'),
  races,
});

describe('通過を、区間に割り直す', () => {
  it('累積から、区間ごとの時間を出す', () => {
    const result = resultOf({
      splits: [
        { km: 5, elapsedSec: 1500 },
        { km: 10, elapsedSec: 3060 },
      ],
      finishSec: 3060,
    });
    const segments = segmentsOf(result, 10);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ fromKm: 0, toKm: 5, sec: 1500 });
    // 2本目は 3060 − 1500 = 1560秒。引き算しないと「どこで落ちたか」が読めない。
    expect(segments[1]).toMatchObject({ fromKm: 5, toKm: 10, sec: 1560 });
  });

  /** フルの 40km〜ゴールは 2.195km。ここがいちばん苦しい。落としてはいけない。 */
  it('最後の通過からゴールまでを、区間として足す', () => {
    const result = resultOf({ splits: evenSplits(300), finishSec: 12_700 });
    const segments = segmentsOf(result, MARATHON);
    const last = segments[segments.length - 1];
    expect(last.fromKm).toBe(40);
    expect(last.toKm).toBeCloseTo(MARATHON, 3);
    expect(last.sec).toBe(12_700 - 12_000);
  });

  it('距離が分からなければ、最後の区間は足さない（無い数字を作らない）', () => {
    const result = resultOf({ splits: evenSplits(300), finishSec: 12_700 });
    const segments = segmentsOf(result, undefined);
    expect(segments[segments.length - 1].toKm).toBe(40);
  });

  it('通過が順番に並んでいなくても、並べ直して読む', () => {
    const result = resultOf({
      splits: [
        { km: 10, elapsedSec: 3000 },
        { km: 5, elapsedSec: 1500 },
      ],
      finishSec: 3000,
    });
    expect(segmentsOf(result, 10).map((s) => s.toKm)).toEqual([5, 10]);
  });

  it('通過が無くても、完走タイムだけで1区間になる', () => {
    const segments = segmentsOf(resultOf(), MARATHON);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ fromKm: 0, sec: 12_600 });
  });

  it('通過も距離も無ければ、区間は出さない', () => {
    expect(segmentsOf(resultOf(), undefined)).toHaveLength(0);
  });
});

describe('後半の落ち率', () => {
  it('一定で走れば、落ち率はほぼ0', () => {
    const result = resultOf({ splits: evenSplits(300), finishSec: Math.round(300 * MARATHON) });
    const fade = fadeOf(result, MARATHON);
    expect(fade).not.toBeNull();
    expect(Math.abs(fade!.percent)).toBeLessThan(0.5);
  });

  /** 市民ランナーの大会は、ほぼ全部ここで決まる。 */
  it('後半に落ちれば、プラスの落ち率になる', () => {
    // 前半 5:00/km、後半 5:30/km。
    const splits = [];
    let elapsed = 0;
    for (let km = 5; km <= 40; km += 5) {
      elapsed += 5 * (km <= 20 ? 300 : 330);
      splits.push({ km, elapsedSec: elapsed });
    }
    const fade = fadeOf(resultOf({ splits, finishSec: elapsed + Math.round(2.195 * 330) }), MARATHON);
    expect(fade!.percent).toBeGreaterThan(5);
    expect(fade!.negative).toBe(false);
    expect(fade!.deltaSec).toBeGreaterThan(0);
  });

  it('後半に上げれば、ネガティブスプリットと分かる', () => {
    const splits = [];
    let elapsed = 0;
    for (let km = 5; km <= 40; km += 5) {
      elapsed += 5 * (km <= 20 ? 330 : 300);
      splits.push({ km, elapsedSec: elapsed });
    }
    const fade = fadeOf(resultOf({ splits, finishSec: elapsed + Math.round(2.195 * 300) }), MARATHON);
    expect(fade!.negative).toBe(true);
    expect(fade!.percent).toBeLessThan(0);
  });

  /**
   * 中間点（21.0975km）は 20〜25km の区間の中にある。
   * 本数で半分に割ると、その区間がまるごと後半に入って落ち率が歪む。
   */
  it('中間点をまたぐ区間は、距離の比で前後に分ける', () => {
    const splits = [];
    let elapsed = 0;
    for (let km = 5; km <= 40; km += 5) {
      // 20〜25km だけ極端に遅くする。本数で割ると、ここが丸ごと後半に入る。
      elapsed += 5 * (km === 25 ? 600 : 300);
      splits.push({ km, elapsedSec: elapsed });
    }
    const fade = fadeOf(resultOf({ splits, finishSec: elapsed + Math.round(2.195 * 300) }), MARATHON);
    // 遅い区間の一部は前半に入るので、前半も目標ペースより遅くなる。
    expect(fade!.firstHalfPaceSec).toBeGreaterThan(300);
  });

  it('区間が1本しか無ければ、落ち率は出さない', () => {
    const result = resultOf({ splits: [{ km: 5, elapsedSec: 1500 }], finishSec: 1500 });
    expect(fadeOf(result, undefined)).toBeNull();
  });
});

describe('読み取りを、入れる前に確かめる', () => {
  it('噛み合っていれば通す', () => {
    const result = resultOf({ splits: evenSplits(300), finishSec: 12_700 });
    expect(validateResult(result, MARATHON).ok).toBe(true);
  });

  it('完走タイムが無ければ通さない', () => {
    expect(validateResult({ finishSec: 0 }, MARATHON).ok).toBe(false);
  });

  /** 「1:52:30」が「52:30」に読めてしまう事故。 */
  it('距離に対して速すぎるタイムを通さない', () => {
    const check = validateResult({ finishSec: 3150 }, MARATHON);
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toContain('速すぎます');
  });

  it('距離に対して遅すぎるタイムを通さない', () => {
    const check = validateResult({ finishSec: 60 * 60 * 20 }, MARATHON);
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toContain('遅すぎます');
  });

  /** 累積と区間タイムの取り違え。記録証の読み方でいちばん多い間違い。 */
  it('通過が前に戻っていたら通さない', () => {
    const check = validateResult(
      {
        finishSec: 12_600,
        splits: [
          { km: 5, elapsedSec: 1500 },
          { km: 10, elapsedSec: 1490 },
        ],
      },
      MARATHON,
    );
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toContain('スタートからの合計');
  });

  it('同じ地点が二度出てきたら通さない', () => {
    const check = validateResult(
      {
        finishSec: 12_600,
        splits: [
          { km: 5, elapsedSec: 1500 },
          { km: 5, elapsedSec: 3000 },
        ],
      },
      MARATHON,
    );
    expect(check.ok).toBe(false);
  });

  it('区間のペースがあり得なければ通さない', () => {
    const check = validateResult(
      {
        finishSec: 12_600,
        splits: [
          { km: 5, elapsedSec: 1500 },
          { km: 10, elapsedSec: 1600 },
        ],
      },
      MARATHON,
    );
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toContain('区間');
  });

  it('通過が大会の距離を超えていたら通さない', () => {
    const check = validateResult(
      { finishSec: 12_600, splits: [{ km: 50, elapsedSec: 12_000 }] },
      MARATHON,
    );
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toContain('超えています');
  });

  it('最後の通過が完走タイム以上なら通さない', () => {
    const check = validateResult(
      { finishSec: 12_000, splits: [{ km: 40, elapsedSec: 12_300 }] },
      MARATHON,
    );
    expect(check.ok).toBe(false);
  });

  it('距離が分からなくても、通過どうしの噛み合いは見る', () => {
    const check = validateResult(
      {
        finishSec: 12_600,
        splits: [
          { km: 5, elapsedSec: 1500 },
          { km: 10, elapsedSec: 1490 },
        ],
      },
      undefined,
    );
    expect(check.ok).toBe(false);
  });

  it('通過が1つも無くても、完走タイムだけで通す', () => {
    expect(validateResult({ finishSec: 12_600 }, MARATHON).ok).toBe(true);
  });
});

describe('ためた大会', () => {
  it('記録の入っているものだけ、新しい順に', () => {
    const profile = profileOf([
      raceOf({ id: 'a', date: '2025-03-01', result: resultOf() }),
      raceOf({ id: 'b', date: '2026-03-01', result: resultOf() }),
      raceOf({ id: 'c', date: '2026-11-01' }),
    ]);
    expect(finishedRaces(profile).map((race) => race.id)).toEqual(['b', 'a']);
  });

  it('記録が無ければ空', () => {
    expect(finishedRaces(profileOf([raceOf()]))).toHaveLength(0);
  });
});

describe('自己ベスト', () => {
  it('同じ距離でいちばん速ければ、自己ベスト', () => {
    const fast = raceOf({ id: 'a', date: '2026-03-01', result: resultOf({ finishSec: 12_000 }) });
    const slow = raceOf({ id: 'b', date: '2025-03-01', result: resultOf({ finishSec: 12_600 }) });
    const profile = profileOf([fast, slow]);
    expect(isPersonalBest(fast, profile, NOW)).toBe(true);
    expect(isPersonalBest(slow, profile, NOW)).toBe(false);
  });

  /** ハーフのタイムをフルと並べない。 */
  it('距離が違えば、比べない', () => {
    const half = raceOf({
      id: 'h',
      distance: 'ハーフ',
      date: '2026-03-01',
      result: resultOf({ finishSec: 5400 }),
    });
    const full = raceOf({ id: 'f', date: '2026-04-01', result: resultOf({ finishSec: 12_600 }) });
    const profile = profileOf([half, full]);
    expect(isPersonalBest(half, profile, NOW)).toBe(true);
    expect(isPersonalBest(full, profile, NOW)).toBe(true);
  });

  it('1本しか無ければ、それが自己ベスト', () => {
    const only = raceOf({ result: resultOf() });
    expect(isPersonalBest(only, profileOf([only]), NOW)).toBe(true);
  });

  it('記録が無ければ、自己ベストにしない', () => {
    const race = raceOf();
    expect(isPersonalBest(race, profileOf([race]), NOW)).toBe(false);
  });

  it('距離ごとに1本ずつ、短い順に出す', () => {
    const profile = profileOf([
      raceOf({ id: 'f1', date: '2026-03-01', result: resultOf({ finishSec: 12_600 }) }),
      raceOf({ id: 'f2', date: '2026-04-01', result: resultOf({ finishSec: 12_000 }) }),
      raceOf({
        id: 'h1',
        distance: 'ハーフ',
        date: '2026-05-01',
        result: resultOf({ finishSec: 5400 }),
      }),
    ]);
    const bests = personalBests(profile);
    expect(bests.map((best) => best.label)).toEqual(['ハーフ', 'フル']);
    expect(bests.find((best) => best.label === 'フル')?.race.id).toBe('f2');
  });
});

describe('距離の呼び名', () => {
  it('42.195 は「フル」', () => {
    expect(distanceLabel(42.195)).toBe('フル');
  });

  it('21.0975 は「ハーフ」', () => {
    expect(distanceLabel(21.0975)).toBe('ハーフ');
  });

  it('それ以外は km で', () => {
    expect(distanceLabel(10)).toBe('10km');
  });

  it('画面に出す文字に ** が残っていない', () => {
    for (const km of [42.195, 21.0975, 10, 100]) {
      expect(distanceLabel(km)).not.toContain('**');
    }
  });
});
