import { describe, expect, it, vi } from 'vitest';
import { WEATHER_STALE_HOURS, dewPointC, fetchWeather, heatAdvice, isFresh } from '@/lib/weather';
import type { Weather } from '@/lib/weather';

/**
 * 暑さ・寒さを、走る前に言う。
 *
 * **時計は走り終えてから「暑さの影響がありました」と言う。**
 * それは記録の説明にはなっても、走る前の判断には1秒も役に立たない。
 *
 * 守るのは、走るなと言わないことと、細かい数字を装わないこと。
 */

const NOW = new Date('2026-07-20T06:00:00+09:00');
const air = (temperatureC: number, humidity: number, at = NOW.toISOString()): Weather => ({
  temperatureC,
  humidity,
  at,
});

describe('露点', () => {
  /** 気温だけでは足りない。体温を下げられるかは、湿度で決まる。 */
  it('同じ気温でも、湿度が高いほど高くなる', () => {
    expect(dewPointC(30, 30)).toBeLessThan(dewPointC(30, 80));
  });

  it('よく知られた値に近い', () => {
    // 気温30度・湿度70% の露点は、およそ24度。
    expect(dewPointC(30, 70)).toBeGreaterThan(23);
    expect(dewPointC(30, 70)).toBeLessThan(25);
    // 気温20度・湿度50% は、およそ9度。
    expect(dewPointC(20, 50)).toBeGreaterThan(8);
    expect(dewPointC(20, 50)).toBeLessThan(11);
  });

  it('ありえない湿度でも落ちない', () => {
    expect(Number.isFinite(dewPointC(25, 0))).toBe(true);
    expect(Number.isFinite(dewPointC(25, 120))).toBe(true);
  });
});

describe('どれだけ落とすか', () => {
  it('涼しい日は、何も言わない', () => {
    const advice = heatAdvice(air(12, 50));
    expect(advice.level).toBe('none');
    expect(advice.headline).toContain('走りやすい');
  });

  it('蒸し暑い日は、落とす幅を秒で出す', () => {
    // 26度・湿度70% → 露点20度あたり。イージー 6:00/km（360秒）とする。
    const advice = heatAdvice(air(26, 70), 360);

    expect(advice.level).toBe('strong');
    expect(advice.slowSecFrom).toBeGreaterThan(0);
    expect(advice.slowSecTo).toBeGreaterThan(advice.slowSecFrom!);
    expect(advice.headline).toContain('秒落として');
  });

  /** **幅で出す。** 1秒単位で出すと、当たっているように見えてしまう。 */
  it('1点ではなく幅で言う', () => {
    const advice = heatAdvice(air(26, 70), 360);
    expect(advice.headline).toMatch(/\d+〜\d+秒/);
  });

  /** **走るなとは言わない。** 言うのは、どれだけ落とすかだけ。 */
  it('どんなに暑くても、走るなとは言わない', () => {
    for (const [t, h] of [[30, 80], [34, 70], [38, 60]] as const) {
      const advice = heatAdvice(air(t, h), 360);
      const all = `${advice.headline}${advice.detail}`;
      expect(all).not.toContain('走らない');
      expect(all).not.toContain('中止');
    }
  });

  it('落としても危ない日は、時間帯をずらす話にする', () => {
    const advice = heatAdvice(air(32, 80), 360);
    expect(advice.level).toBe('severe');
    expect(advice.detail).toContain('朝晩にずらせる');
    expect(advice.detail).toContain('ペースは見ずに');
  });

  /** 落としたぶんを「遅くなった」と数えさせない。 */
  it('落とした結果を、記録の悪化として扱わせない', () => {
    // 暑い日のどの段階でも言う。ここを落とすと、暑さのぶんを自分の力だと誤解する。
    for (const [t, h] of [[26, 70], [32, 80]] as const) {
      expect(heatAdvice(air(t, h), 360).detail).toContain('「遅くなった」と数えないで');
    }
  });

  it('寒い日は、ペースではなく準備の話にする', () => {
    const advice = heatAdvice(air(1, 50), 360);
    expect(advice.level).toBe('cold');
    expect(advice.slowPercent).toBe(0);
    expect(advice.detail).toContain('最初の10分');
  });

  it('ペースが分からなくても、割合で言える', () => {
    const advice = heatAdvice(air(26, 70));
    expect(advice.slowSecFrom).toBeUndefined();
    expect(advice.headline).toContain('%');
  });

  /** 画面に地の文として出すので、記号を混ぜない。 */
  it('記号を混ぜない', () => {
    for (const [t, h] of [[12, 50], [20, 60], [28, 80], [33, 80], [1, 40]] as const) {
      const advice = heatAdvice(air(t, h), 360);
      expect(`${advice.headline}${advice.detail}`).not.toContain('**');
    }
  });
});

describe('読みの古さ', () => {
  it('3時間を超えた読みは使わない', () => {
    expect(WEATHER_STALE_HOURS).toBe(3);
    expect(isFresh(air(28, 80, NOW.toISOString()), NOW)).toBe(true);
    const old = new Date(NOW.getTime() - 4 * 3_600_000).toISOString();
    expect(isFresh(air(28, 80, old), NOW)).toBe(false);
  });

  it('無い・壊れている時は、使わない', () => {
    expect(isFresh(undefined, NOW)).toBe(false);
    expect(isFresh(air(28, 80, 'not-a-date'), NOW)).toBe(false);
  });
});

describe('取りに行くところ', () => {
  const ok = (body: unknown) =>
    vi.fn(async (_url: string, _init?: RequestInit) =>
      ({ ok: true, json: async () => body }) as unknown as Response,
    );

  it('いまの気温と湿度を読む', async () => {
    const fetchImpl = ok({ current: { temperature_2m: 28.4, relative_humidity_2m: 78 } });
    const weather = await fetchWeather(35.681, 139.767, fetchImpl as never, NOW);

    expect(weather).toEqual({ temperatureC: 28.4, humidity: 78, at: NOW.toISOString() });
  });

  /** **番地は持たない。** 天気を引くのに要るのは、おおよその場所まで。 */
  it('場所は小数2桁までしか送らない', async () => {
    const fetchImpl = ok({ current: { temperature_2m: 20, relative_humidity_2m: 50 } });
    await fetchWeather(35.6812362, 139.7671248, fetchImpl as never, NOW);

    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.searchParams.get('latitude')).toBe('35.68');
    expect(url.searchParams.get('longitude')).toBe('139.77');
  });

  /** **天気が取れなくても、今日やることは出る。** ここで止めない。 */
  it('失敗しても、例外にしない', async () => {
    const failing = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        ({ ok: false, json: async () => ({}) }) as unknown as Response,
    );
    expect(await fetchWeather(35.68, 139.76, failing as never, NOW)).toBeNull();

    const throwing = vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> => {
      throw new Error('boom');
    });
    expect(await fetchWeather(35.68, 139.76, throwing as never, NOW)).toBeNull();
  });

  it('形が違う返事は、推測で補わない', async () => {
    const weird = ok({ current: { temperature_2m: 'あつい' } });
    expect(await fetchWeather(35.68, 139.76, weird as never, NOW)).toBeNull();
  });
});
