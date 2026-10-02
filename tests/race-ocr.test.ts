import { describe, expect, it } from 'vitest';
import { executeTool } from '@/lib/tools';
import { createDefaultProfile } from '@/lib/types';
import type { RunnerProfile } from '@/lib/types';
import { fetchRaceDayWeather } from '@/lib/weather';
import { fadeOf } from '@/lib/race-result';

/**
 * 記録証から読み取ったものを、入れる口。
 *
 * **ここが、このツールのいちばん壊れやすい場所。**
 * 写真から読む以上、桁の読み違いは必ず起きる。入れてしまえば、
 * 本人が何年も見返す一覧がそこで壊れて、以後ずっと直らない。
 */

const NOW = new Date('2026-10-02T12:00:00+09:00');
const base = (): RunnerProfile => createDefaultProfile('u1', '2026-01-01T00:00:00.000Z');

const good = {
  name: '東京マラソン',
  date: '2026-03-01',
  distance: 'フル',
  finishTime: '3:28:41',
  splits: [
    { km: 5, time: '24:30' },
    { km: 10, time: '49:10' },
    { km: 15, time: '1:13:50' },
    { km: 20, time: '1:38:40' },
    { km: 25, time: '2:03:50' },
    { km: 30, time: '2:29:30' },
    { km: 35, time: '2:56:00' },
    { km: 40, time: '3:17:40' },
  ],
};

describe('記録証を入れる', () => {
  it('噛み合っていれば入る', () => {
    const out = executeTool(base(), 'log_race_result', good, NOW);
    expect(out.result).toMatchObject({ ok: true });

    const race = out.profile.races?.[0];
    expect(race?.name).toBe('東京マラソン');
    expect(race?.result?.finishSec).toBe(3 * 3600 + 28 * 60 + 41);
    expect(race?.result?.splits).toHaveLength(8);
  });

  it('大会が登録されていなくても、記録証だけで入る', () => {
    // 出場予定を先に登録してから走る人ばかりではない。
    const out = executeTool(base(), 'log_race_result', good, NOW);
    expect(out.profile.races).toHaveLength(1);
  });

  it('すでに登録してある大会には、上書きせず記録だけ足す', () => {
    const withRace = executeTool(
      base(),
      'add_race',
      { name: '東京マラソン', date: '2026-03-01', distance: 'フル', targetTime: '3:30:00', priority: 'A' },
      NOW,
    ).profile;

    const out = executeTool(withRace, 'log_race_result', good, NOW);
    expect(out.profile.races).toHaveLength(1);
    expect(out.profile.races?.[0].targetTime).toBe('3:30:00');
    expect(out.profile.races?.[0].result?.finishSec).toBeGreaterThan(0);
  });

  /** 同じ大会を登録し直すたびに記録証が消えるのでは、ためる意味が無い。 */
  it('大会を登録し直しても、入れた記録は消えない', () => {
    const withResult = executeTool(base(), 'log_race_result', good, NOW).profile;
    const again = executeTool(
      withResult,
      'add_race',
      { name: '東京マラソン', date: '2026-03-01', distance: 'フル', targetTime: '3:20:00', priority: 'A' },
      NOW,
    ).profile;

    expect(again.races?.[0].result?.finishSec).toBe(3 * 3600 + 28 * 60 + 41);
    expect(again.races?.[0].targetTime).toBe('3:20:00');
  });

  it('落ち率を計算して返す（モデルに引き算させない）', () => {
    const out = executeTool(base(), 'log_race_result', good, NOW);
    const result = out.result as { fadePercent?: number };
    expect(typeof result.fadePercent).toBe('number');

    // 返した数字が、保存したものから出し直した数字と一致すること。
    const race = out.profile.races?.[0];
    expect(result.fadePercent).toBe(fadeOf(race!.result!, 42.195)?.percent);
  });
});

describe('読み違いを、入れる前に断る', () => {
  /** 「1:52:30」が「52:30」に読めてしまう事故。 */
  it('距離に対して速すぎるタイムは断る', () => {
    const out = executeTool(base(), 'log_race_result', { ...good, finishTime: '52:30', splits: [] }, NOW);
    expect(out.result).toMatchObject({ ok: false });
    expect(out.profile.races ?? []).toHaveLength(0);
  });

  /**
   * 累積と区間タイムの取り違え。記録証の読み方でいちばん多い間違い。
   * どちらの形で来ても断れること。
   */
  it('通過を区間タイムで渡されたら断る（5kmぶんが10秒になる）', () => {
    const out = executeTool(
      base(),
      'log_race_result',
      {
        ...good,
        splits: [
          { km: 5, time: '24:30' },
          { km: 10, time: '24:40' },
        ],
      },
      NOW,
    );
    expect(out.result).toMatchObject({ ok: false });
    expect((out.result as { error: string }).error).toContain('区間');
  });

  it('通過が前の通過より早ければ断る', () => {
    const out = executeTool(
      base(),
      'log_race_result',
      {
        ...good,
        splits: [
          { km: 5, time: '24:30' },
          { km: 10, time: '24:20' },
        ],
      },
      NOW,
    );
    expect(out.result).toMatchObject({ ok: false });
    expect((out.result as { error: string }).error).toContain('スタートからの合計');
  });

  it('断る時は、読み直す指示まで返す', () => {
    const out = executeTool(base(), 'log_race_result', { ...good, finishTime: '52:30', splits: [] }, NOW);
    expect((out.result as { error: string }).error).toContain('入れ直す');
  });

  it('完走タイムが読めなければ断る', () => {
    const out = executeTool(base(), 'log_race_result', { ...good, finishTime: 'わからない' }, NOW);
    expect(out.result).toMatchObject({ ok: false });
  });

  it('日付の形が違えば断る', () => {
    const out = executeTool(base(), 'log_race_result', { ...good, date: '2026/03/01' }, NOW);
    expect(out.result).toMatchObject({ ok: false });
  });

  it('通過の形が違えば断る', () => {
    const out = executeTool(
      base(),
      'log_race_result',
      { ...good, splits: [{ km: 5 }] },
      NOW,
    );
    expect(out.result).toMatchObject({ ok: false });
  });
});

describe('無い数字を埋めない', () => {
  it('気温が渡されなければ、気象は空のまま', () => {
    const out = executeTool(base(), 'log_race_result', good, NOW);
    expect(out.profile.races?.[0].result?.weather).toBeUndefined();
  });

  it('記録証に印字された気温は、出どころを残して入れる', () => {
    const out = executeTool(base(), 'log_race_result', { ...good, tempC: 9.5 }, NOW);
    expect(out.profile.races?.[0].result?.weather).toMatchObject({
      tempC: 9.5,
      source: 'certificate',
    });
  });

  it('あり得ない気温は入れない', () => {
    const out = executeTool(base(), 'log_race_result', { ...good, tempC: 500 }, NOW);
    expect(out.profile.races?.[0].result?.weather).toBeUndefined();
  });

  it('通過が1つも読めなくても、完走タイムだけで入る', () => {
    const out = executeTool(base(), 'log_race_result', { ...good, splits: [] }, NOW);
    expect(out.result).toMatchObject({ ok: true });
    expect(out.profile.races?.[0].result?.splits).toBeUndefined();
  });
});

/**
 * 当日の気象。
 *
 * **この環境からは外に出られない**（CONNECT が 403 で塞がれている）ので、
 * 返事を差し替えて確かめる。本番での疎通は、デプロイ後に確かめること。
 */
describe('当日の気象を取る', () => {
  const reply = (body: unknown, ok = true) =>
    (() =>
      Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response)) as unknown as typeof fetch;

  it('観測から、その日の気温を出す', async () => {
    const weather = await fetchRaceDayWeather(
      35.68,
      139.76,
      '2026-03-01',
      reply({
        daily: {
          temperature_2m_max: [12],
          temperature_2m_min: [4],
          relative_humidity_2m_mean: [55],
          wind_speed_10m_max: [18],
        },
      }),
    );
    // 最高を当てると暑すぎる。中間を出す。
    expect(weather?.tempC).toBe(8);
    expect(weather?.humidity).toBe(55);
    // km/h から m/s に直す。
    expect(weather?.windMs).toBe(5);
  });

  it('位置が無ければ、何も出さない', async () => {
    expect(await fetchRaceDayWeather(NaN, 139.76, '2026-03-01', reply({}))).toBeNull();
  });

  it('日付の形が違えば、何も出さない', async () => {
    expect(await fetchRaceDayWeather(35.68, 139.76, '2026/03/01', reply({}))).toBeNull();
  });

  it('観測が返らなければ、何も出さない', async () => {
    expect(await fetchRaceDayWeather(35.68, 139.76, '2026-03-01', reply({ daily: {} }))).toBeNull();
  });

  it('向こうが落ちていても、例外を投げない', async () => {
    const dead = (() => Promise.reject(new Error('boom'))) as unknown as typeof fetch;
    expect(await fetchRaceDayWeather(35.68, 139.76, '2026-03-01', dead)).toBeNull();
  });

  it('あり得ない気温は捨てる', async () => {
    const weather = await fetchRaceDayWeather(
      35.68,
      139.76,
      '2026-03-01',
      reply({ daily: { temperature_2m_max: [900], temperature_2m_min: [900] } }),
    );
    expect(weather).toBeNull();
  });
});
