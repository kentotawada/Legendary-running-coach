/**
 * 時計から書き出したファイル（GPX / TCX）を読む。
 *
 * 外部サービスの窓口は、相手の都合で有料になったり閉じたりします。実際にそうなりました。
 * **書き出したファイルだけは、誰の許可も要りません。** ここが、取り上げられない道です。
 *
 * 読むのはブラウザ側です。2時間のロング走の GPX は数MBになり、
 * そのまま送るとサーバーの受信上限に当たるため、
 * **手元で数値に直してから、小さな JSON だけを送ります。**
 *
 * FIT（Garmin の生ファイル）は独自の二進形式なので、ここでは扱いません。
 * Garmin Connect から GPX か TCX で書き出せば、こちらの方が中身は同じです。
 */

import type { ActivityType } from './types';
import type { ImportedWorkout, WorkoutLap, WorkoutSample } from './workout';

export class WorkoutFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkoutFileError';
  }
}

/**
 * 正規表現は使い回す。
 * 1時間のロング走は数千点あり、点ごとに組み直すと数万回の生成になる。
 */
const cache = new Map<string, RegExp>();

function tagPattern(tag: string): RegExp {
  const key = `t:${tag}`;
  let pattern = cache.get(key);
  if (!pattern) {
    pattern = new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${tag}>)`, 'g');
    cache.set(key, pattern);
  }
  pattern.lastIndex = 0;
  return pattern;
}

/** 名前空間の接頭辞（ns3: や gpxtpx:）は無視して、同じ名前の中身を全部取る。 */
function blocks(xml: string, tag: string): { attrs: string; inner: string }[] {
  const found: { attrs: string; inner: string }[] = [];
  for (const match of xml.matchAll(tagPattern(tag))) {
    found.push({ attrs: match[1] ?? '', inner: match[2] ?? '' });
  }
  return found;
}

/** 最初に見つかった同名タグの中身。 */
function text(xml: string, tag: string): string | undefined {
  const first = blocks(xml, tag)[0];
  const value = first?.inner.trim();
  return value ? value : undefined;
}

function num(xml: string, tag: string): number | undefined {
  const value = Number(text(xml, tag));
  return Number.isFinite(value) ? value : undefined;
}

function attr(attrs: string, name: string): string | undefined {
  const match = attrs.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i'));
  return match?.[1];
}

/** ISO の時刻。読めなければ undefined。 */
function time(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * 走り始めた時刻。
 *
 * **ここで日付にしない。** 書き出したファイルの時刻はたいてい UTC なので、
 * 先頭10文字を取ると、日本の朝6時の練習が前日になる。
 * 何日の練習かは、走る人の時刻を知っている側（workout.ts）が決める。
 */
function startedAt(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  return Number.isNaN(Date.parse(iso)) ? undefined : iso;
}

const EARTH_M = 6_371_000;

/** 2点間の距離(m)。GPX には距離が書かれていないので、座標から積む。 */
function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLon = (bLon - aLon) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** TCX の Sport 属性から種目を決める。 */
function sportOf(sport: string | undefined): ActivityType {
  const value = (sport ?? '').toLowerCase();
  if (value.includes('run')) return 'run';
  if (value.includes('walk') || value.includes('hik')) return 'walk';
  return 'cross';
}

/**
 * 種目が書かれていない GPX のための推定。
 *
 * **平均速度からしか判断できない。** 自転車と走りは速度が重なるので、
 * 重なる帯（〜18km/h）はランとして扱う。18km/h はキロ3分20秒で、
 * 市民ランナーが1本まるごと平均する速度ではないため、そこを境にする。
 */
function guessType(meters: number, seconds: number): ActivityType {
  if (meters <= 0 || seconds <= 0) return 'run';
  const kmh = meters / 1000 / (seconds / 3600);
  if (kmh >= 18) return 'cross';
  return kmh >= 7 ? 'run' : 'walk';
}

/** 自動命名は練習の種別として使わない。本人が書き換えていれば、意味のある情報として残す。 */
function meaningfulName(name: string | undefined): string | undefined {
  const trimmed = name?.trim();
  if (!trimmed) return undefined;
  if (/^(Morning|Afternoon|Evening|Lunch|Night|Late Night)\s+\w+/i.test(trimmed)) return undefined;
  if (/^(ランニング|ウォーキング|アクティビティ|サイクリング)$/.test(trimmed)) return undefined;
  return trimmed.slice(0, 40);
}

function parseTcx(xml: string): ImportedWorkout[] {
  const workouts: ImportedWorkout[] = [];

  for (const activity of blocks(xml, 'Activity')) {
    const started = startedAt(text(activity.inner, 'Id'));
    if (!started) continue;

    let meters = 0;
    let seconds = 0;
    let maxHr: number | undefined;
    // 平均は「時間で重みを付ける」。ラップの長さが違うのに単純平均すると、短い1本に引きずられる。
    let hrWeighted = 0;
    let hrSeconds = 0;
    let cadenceWeighted = 0;
    let cadenceSeconds = 0;

    const laps: WorkoutLap[] = [];

    for (const lap of blocks(activity.inner, 'Lap')) {
      const lapSeconds = num(lap.inner, 'TotalTimeSeconds') ?? 0;
      const lapMeters = num(lap.inner, 'DistanceMeters') ?? 0;
      meters += lapMeters;
      seconds += lapSeconds;

      const avg = num(blocks(lap.inner, 'AverageHeartRateBpm')[0]?.inner ?? '', 'Value');
      if (avg !== undefined && lapSeconds > 0) {
        hrWeighted += avg * lapSeconds;
        hrSeconds += lapSeconds;
      }
      const max = num(blocks(lap.inner, 'MaximumHeartRateBpm')[0]?.inner ?? '', 'Value');
      if (max !== undefined) maxHr = Math.max(maxHr ?? 0, max);

      const cadence = num(lap.inner, 'AvgRunCadence') ?? num(lap.inner, 'Cadence');
      if (cadence !== undefined && cadence > 0 && lapSeconds > 0) {
        cadenceWeighted += cadence * lapSeconds;
        cadenceSeconds += lapSeconds;
      }

      if (lapMeters > 0 || lapSeconds > 0) {
        laps.push({
          distanceM: lapMeters,
          durationSec: lapSeconds,
          avgHr: avg,
          maxHr: max,
          cadence: cadence && cadence > 0 ? cadence : undefined,
        });
      }
    }

    // 1秒ごとの推移。**ここが、スクリーンショットでは手に入らない部分。**
    const samples = tcxSamples(activity.inner);

    if (meters <= 0 && seconds <= 0) continue;

    workouts.push({
      externalId: `file:${started}`,
      startedAt: started,
      type: sportOf(attr(activity.attrs, 'Sport')),
      distanceM: meters > 0 ? Math.round(meters) : undefined,
      durationSec: seconds > 0 ? Math.round(seconds) : undefined,
      avgHr: hrSeconds > 0 ? hrWeighted / hrSeconds : undefined,
      maxHr,
      cadence: cadenceSeconds > 0 ? cadenceWeighted / cadenceSeconds : undefined,
      name: meaningfulName(text(activity.inner, 'Notes')),
      source: 'file',
      laps: laps.length > 1 ? laps : undefined,
      samples: samples.length > 1 ? samples : undefined,
    });
  }

  return workouts;
}

/**
 * TCX のトラックポイントを、経過秒・累計距離・心拍の並びに直す。
 * 距離は活動の開始からの累計で入っている（Garmin の書き方）。
 */
function tcxSamples(activityXml: string): WorkoutSample[] {
  const samples: WorkoutSample[] = [];
  let firstMs: number | undefined;

  for (const point of blocks(activityXml, 'Trackpoint')) {
    const ms = time(text(point.inner, 'Time'));
    if (ms === undefined) continue;
    if (firstMs === undefined) firstMs = ms;

    const hr = num(blocks(point.inner, 'HeartRateBpm')[0]?.inner ?? '', 'Value');
    const cadence = num(point.inner, 'RunCadence') ?? num(point.inner, 'Cadence');
    samples.push({
      t: Math.round((ms - firstMs) / 1000),
      d: num(point.inner, 'DistanceMeters'),
      hr: hr !== undefined && hr > 0 ? hr : undefined,
      cadence: cadence !== undefined && cadence > 0 ? cadence : undefined,
    });
  }

  return samples;
}

/** 気圧・GPS のぶれで標高は細かく上下する。この幅より小さい変化は積まない。 */
const ELEVATION_NOISE_M = 1;

function parseGpx(xml: string): ImportedWorkout[] {
  const workouts: ImportedWorkout[] = [];

  for (const track of blocks(xml, 'trk')) {
    let meters = 0;
    let gain = 0;
    let hrSum = 0;
    let hrCount = 0;
    let maxHr: number | undefined;
    let cadenceSum = 0;
    let cadenceCount = 0;
    let firstMs: number | undefined;
    let lastMs: number | undefined;
    let prev: { lat: number; lon: number; ele?: number } | undefined;
    let startedIso: string | undefined;
    const samples: WorkoutSample[] = [];

    for (const point of blocks(track.inner, 'trkpt')) {
      const lat = Number(attr(point.attrs, 'lat'));
      const lon = Number(attr(point.attrs, 'lon'));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const ele = num(point.inner, 'ele');
      if (prev) {
        meters += haversine(prev.lat, prev.lon, lat, lon);
        if (prev.ele !== undefined && ele !== undefined) {
          const up = ele - prev.ele;
          if (up > ELEVATION_NOISE_M) gain += up;
        }
      }
      prev = { lat, lon, ele };

      const iso = text(point.inner, 'time');
      const ms = time(iso);
      if (ms !== undefined) {
        if (firstMs === undefined) {
          firstMs = ms;
          startedIso = iso;
        }
        lastMs = ms;
      }

      const hr = num(point.inner, 'hr');
      if (hr !== undefined && hr > 0) {
        hrSum += hr;
        hrCount += 1;
        maxHr = Math.max(maxHr ?? 0, hr);
      }
      const cadence = num(point.inner, 'cad');
      if (cadence !== undefined && cadence > 0) {
        cadenceSum += cadence;
        cadenceCount += 1;
      }

      if (ms !== undefined && firstMs !== undefined) {
        samples.push({
          t: Math.round((ms - firstMs) / 1000),
          d: Math.round(meters),
          hr: hr !== undefined && hr > 0 ? hr : undefined,
          cadence: cadence !== undefined && cadence > 0 ? cadence : undefined,
        });
      }
    }

    const seconds = firstMs !== undefined && lastMs !== undefined ? (lastMs - firstMs) / 1000 : 0;
    const started = startedAt(startedIso) ?? startedAt(text(xml, 'time'));
    if (!started) continue;
    if (meters <= 0 && seconds <= 0) continue;

    const declared = text(track.inner, 'type');
    workouts.push({
      externalId: `file:${started}`,
      startedAt: started,
      type: declared ? sportOf(declared) : guessType(meters, seconds),
      distanceM: meters > 0 ? Math.round(meters) : undefined,
      durationSec: seconds > 0 ? Math.round(seconds) : undefined,
      avgHr: hrCount > 0 ? hrSum / hrCount : undefined,
      maxHr,
      cadence: cadenceCount > 0 ? cadenceSum / cadenceCount : undefined,
      elevationGainM: gain > 0 ? gain : undefined,
      name: meaningfulName(text(track.inner, 'name')),
      source: 'file',
      // GPX にラップは無い。1kmごとの区切りは、推移から切り出す。
      samples: samples.length > 1 ? samples : undefined,
    });
  }

  return workouts;
}

/** 受け取れるファイルの上限。ロング走の GPX でも数MBに収まる。 */
export const MAX_FILE_BYTES = 12 * 1024 * 1024;

/**
 * 書き出したファイルを、正規化された練習に直す。
 * 読めない時は、何が違うのかを日本語で返す。画面にそのまま出すため。
 */
export function parseWorkoutFile(fileName: string, xml: string): ImportedWorkout[] {
  const name = fileName.toLowerCase();

  if (name.endsWith('.fit')) {
    throw new WorkoutFileError(
      'FIT ファイルは読めません。書き出しの画面で GPX か TCX を選んでください。',
    );
  }

  const isTcx = xml.includes('TrainingCenterDatabase') || name.endsWith('.tcx');
  const isGpx = /<(?:\w+:)?gpx\b/.test(xml) || name.endsWith('.gpx');

  const workouts = isTcx ? parseTcx(xml) : isGpx ? parseGpx(xml) : [];

  if (!isTcx && !isGpx) {
    throw new WorkoutFileError(
      'このファイルは読めませんでした。GPX か TCX を選んでください（Garmin Connect なら、練習の画面の「…」から書き出せます）。',
    );
  }
  if (workouts.length === 0) {
    throw new WorkoutFileError('ファイルの中に練習が見つかりませんでした。');
  }

  return workouts;
}
