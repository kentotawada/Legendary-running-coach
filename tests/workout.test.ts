import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, WorkoutFileError, parseWorkoutFile } from '@/lib/workout-file';
import {
  describeImport,
  importWorkouts,
  normalizeCadence,
  toActivity,
  type ImportedWorkout,
} from '@/lib/workout';
import { addShoes, applyProfileUpdate } from '@/lib/profile';
import { activeShoes } from '@/lib/shoes';
import { createDefaultProfile } from '@/lib/types';

const NOW = new Date('2026-09-25T04:00:00Z');

/** Garmin が書き出す TCX と同じ形。ラップが2本ある18kmのロング走。 */
const TCX = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
 <Activities>
  <Activity Sport="Running">
   <Id>2026-09-22T00:01:15.000Z</Id>
   <Lap StartTime="2026-09-22T00:01:15.000Z">
    <TotalTimeSeconds>1800.0</TotalTimeSeconds>
    <DistanceMeters>9000.0</DistanceMeters>
    <AverageHeartRateBpm><Value>150</Value></AverageHeartRateBpm>
    <MaximumHeartRateBpm><Value>165</Value></MaximumHeartRateBpm>
    <Extensions><ns3:LX><ns3:AvgRunCadence>86</ns3:AvgRunCadence></ns3:LX></Extensions>
   </Lap>
   <Lap StartTime="2026-09-22T00:31:15.000Z">
    <TotalTimeSeconds>2740.0</TotalTimeSeconds>
    <DistanceMeters>9000.0</DistanceMeters>
    <AverageHeartRateBpm><Value>160</Value></AverageHeartRateBpm>
    <MaximumHeartRateBpm><Value>178</Value></MaximumHeartRateBpm>
    <Extensions><ns3:LX><ns3:AvgRunCadence>88</ns3:AvgRunCadence></ns3:LX></Extensions>
   </Lap>
  </Activity>
 </Activities>
</TrainingCenterDatabase>`;

/** 3点だけの GPX。心拍・ピッチ・標高の拡張つき。 */
const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1">
 <metadata><time>2026-09-22T00:01:15.000Z</time></metadata>
 <trk>
  <name>Morning Run</name>
  <type>running</type>
  <trkseg>
   <trkpt lat="35.0000000" lon="139.0000000">
    <ele>10.0</ele><time>2026-09-22T00:01:15.000Z</time>
    <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>140</gpxtpx:hr><gpxtpx:cad>85</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions>
   </trkpt>
   <trkpt lat="35.0020000" lon="139.0000000">
    <ele>12.0</ele><time>2026-09-22T00:02:15.000Z</time>
    <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>150</gpxtpx:hr><gpxtpx:cad>87</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions>
   </trkpt>
   <trkpt lat="35.0040000" lon="139.0000000">
    <ele>11.0</ele><time>2026-09-22T00:03:15.000Z</time>
    <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>160</gpxtpx:hr><gpxtpx:cad>89</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions>
   </trkpt>
  </trkseg>
 </trk>
</gpx>`;

describe('TCX を読む', () => {
  const [workout] = parseWorkoutFile('activity.tcx', TCX);

  it('ラップを合計して、1本の練習にする', () => {
    expect(workout.type).toBe('run');
    expect(workout.distanceM).toBe(18000);
    expect(workout.durationSec).toBe(4540);
  });

  /**
   * ラップの長さが違うのに単純平均すると、短い1本に引きずられる。
   * 心拍は指導の根拠になる数値なので、ここがずれると評価がずれる。
   */
  it('心拍は、ラップの長さで重みを付けて平均する', () => {
    // (150×1800 + 160×2740) ÷ 4540 = 156.03
    expect(Math.round(workout.avgHr!)).toBe(156);
    expect(workout.maxHr).toBe(178);
  });

  it('ピッチは片脚の回転数で入っていても、spm に直す', () => {
    const activity = toActivity(workout)!;
    // 87.2 回転 → 174 spm
    expect(activity.metrics?.cadence).toBe(174);
  });

  it('距離と時間から、平均ペースを出す', () => {
    const activity = toActivity(workout)!;
    expect(activity.distanceKm).toBe(18);
    expect(activity.durationMin).toBe(76);
    expect(activity.metrics?.avgPace).toBe('4:12/km');
  });
});

describe('GPX を読む', () => {
  const [workout] = parseWorkoutFile('activity.gpx', GPX);

  it('座標から距離を積む', () => {
    // 緯度0.002度 × 2区間 ≈ 445m
    expect(workout.distanceM).toBeGreaterThan(430);
    expect(workout.distanceM).toBeLessThan(460);
    expect(workout.durationSec).toBe(120);
  });

  it('心拍とピッチを拾う', () => {
    expect(Math.round(workout.avgHr!)).toBe(150);
    expect(workout.maxHr).toBe(160);
    expect(toActivity(workout)!.metrics?.cadence).toBe(174);
  });

  /** 気圧とGPSのぶれで標高は細かく上下する。下りを引かず、小さな揺れも積まない。 */
  it('標高は、上った分だけを積む', () => {
    expect(workout.elevationGainM).toBe(2);
  });

  it('自動でつけられた名前は、練習の種別として使わない', () => {
    expect(workout.name).toBeUndefined();
  });
});

describe('何日の練習か', () => {
  /**
   * 書き出したファイルの時刻は UTC。
   * 先頭10文字をそのまま日付にすると、**日本の朝9時の練習が前日に入る。**
   * 週の走行距離が日をまたいでずれ、「先週は走れていない」と誤った評価につながる。
   */
  it('UTC で書かれた朝の練習が、前の日に入らない', () => {
    const [workout] = parseWorkoutFile('activity.tcx', TCX);
    // 2026-09-22T00:01Z = 日本時間 9月22日 午前9時1分
    expect(workout.startedAt.slice(0, 10)).toBe('2026-09-22');
    expect(toActivity(workout)!.date).toBe('2026-09-22');
  });

  it('深夜1時の練習は、前の日のぶんとして数える', () => {
    const late: ImportedWorkout = {
      externalId: 'file:late',
      // 日本時間 9月23日 午前1時 = 前日 16:00 UTC
      startedAt: '2026-09-22T16:00:00.000Z',
      type: 'run',
      distanceM: 10000,
      durationSec: 3000,
      source: 'file',
    };
    expect(toActivity(late)!.date).toBe('2026-09-22');
  });
});

describe('読めないファイル', () => {
  it('FIT は、何を選べばよいかまで言う', () => {
    expect(() => parseWorkoutFile('activity.fit', 'binary')).toThrow(WorkoutFileError);
    expect(() => parseWorkoutFile('activity.fit', 'binary')).toThrow(/GPX か TCX/);
  });

  it('関係のないファイルは、そう言う', () => {
    expect(() => parseWorkoutFile('memo.txt', 'こんにちは')).toThrow(/GPX か TCX/);
  });

  it('中身が空の GPX は、練習が無いと言う', () => {
    expect(() => parseWorkoutFile('empty.gpx', '<gpx></gpx>')).toThrow(/見つかりません/);
  });

  it('大きさの上限を持っている', () => {
    expect(MAX_FILE_BYTES).toBeGreaterThan(1024 * 1024);
  });
});

describe('ピッチの見分け', () => {
  it('片脚の回転数は2倍にする', () => {
    expect(normalizeCadence(86)).toBe(172);
  });

  it('すでに spm なら、そのまま', () => {
    expect(normalizeCadence(174)).toBe(174);
  });

  it('無い値を作らない', () => {
    expect(normalizeCadence(undefined)).toBeUndefined();
    expect(normalizeCadence(0)).toBeUndefined();
  });
});

const run = (id: string, startedAt: string, distanceM: number, durationSec: number): ImportedWorkout => ({
  externalId: id,
  startedAt,
  type: 'run',
  distanceM,
  durationSec,
  source: 'file',
});

describe('カルテへ入れる', () => {
  const base = () => createDefaultProfile('u1', NOW.toISOString());

  it('練習を入れて、件数を返す', () => {
    const result = importWorkouts(base(), [run('file:1', '2026-09-22T00:01:00Z', 18000, 4540)], NOW);
    expect(result.imported).toBe(1);
    expect(result.profile.activities[0]).toMatchObject({
      date: '2026-09-22',
      distanceKm: 18,
      source: 'file',
      externalId: 'file:1',
    });
  });

  it('同じ練習は二度入らない', () => {
    const once = importWorkouts(base(), [run('file:1', '2026-09-22T00:01:00Z', 18000, 4540)], NOW);
    const twice = importWorkouts(once.profile, [run('file:1', '2026-09-22T00:01:00Z', 18000, 4540)], NOW);
    expect(twice.imported).toBe(0);
    expect(twice.skipped).toBe(1);
    expect(twice.profile.activities).toHaveLength(1);
  });

  /**
   * ヘルスケアから入った1本と、同じ練習をファイルから入れた1本は、元IDが違う。
   * 素通りさせると週の走行距離が倍になり、「積みすぎ」と誤った指導につながる。
   */
  it('入口が違っても、同じ練習なら二度入らない', () => {
    const health: ImportedWorkout = {
      ...run('health:abc', '2026-09-22T00:01:00Z', 18000, 4540),
      source: 'health',
    };
    const once = importWorkouts(base(), [health], NOW);
    const again = importWorkouts(once.profile, [run('file:xyz', '2026-09-22T00:02:00Z', 18050, 4545)], NOW);

    expect(again.imported).toBe(0);
    expect(again.skipped).toBe(1);
    expect(again.profile.activities).toHaveLength(1);
  });

  /** 朝と夜に走った日を1本にまとめてしまうと、今度は走行距離が足りなくなる。 */
  it('同じ日でも、別の練習なら両方入る', () => {
    const result = importWorkouts(
      base(),
      [
        run('file:am', '2026-09-22T00:01:00Z', 10000, 2400),
        run('file:pm', '2026-09-22T10:00:00Z', 6000, 1800),
      ],
      NOW,
    );
    expect(result.imported).toBe(2);
    expect(result.profile.activities).toHaveLength(2);
  });

  it('同じ取り込みの中に同じIDが2つあっても、1件だけ入れる', () => {
    const result = importWorkouts(
      base(),
      [run('file:1', '2026-09-22T00:01:00Z', 18000, 4540), run('file:1', '2026-09-22T00:01:00Z', 18000, 4540)],
      NOW,
    );
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('靴が1足だけなら、そこに距離を積む', () => {
    const profile = addShoes(base(), { name: 'ゲルカヤノ31', role: 'daily', km: 100 }, NOW);
    const result = importWorkouts(profile, [run('file:1', '2026-09-22T00:01:00Z', 18000, 4540)], NOW);
    expect(activeShoes(result.profile)[0].km).toBe(118);
  });

  /** 練習用が1足しか無いなら、レース用と並んでいても迷いはない。そこへ積む。 */
  it('練習用が1足だけなら、レース用があっても練習用に積む', () => {
    const profile = addShoes(
      addShoes(base(), { name: 'ゲルカヤノ31', role: 'daily', km: 100 }, NOW),
      { name: 'メタスピード', role: 'race', km: 50 },
      NOW,
    );
    const result = importWorkouts(profile, [run('file:1', '2026-09-22T00:01:00Z', 18000, 4540)], NOW);
    const km = activeShoes(result.profile).map((shoe) => shoe.km).sort((a, b) => a - b);
    expect(km).toEqual([50, 118]);
  });

  /** どれを履いたか分からない時に当てずっぽうで積むと、寿命の警告そのものが信用できなくなる。 */
  it('同じ用途の靴が2足あるなら、当てずっぽうで積まない', () => {
    const profile = addShoes(
      addShoes(base(), { name: 'ゲルカヤノ31', role: 'daily', km: 100 }, NOW),
      { name: 'ペガサス41', role: 'daily', km: 50 },
      NOW,
    );
    const result = importWorkouts(profile, [run('file:1', '2026-09-22T00:01:00Z', 18000, 4540)], NOW);
    const km = activeShoes(result.profile).map((shoe) => shoe.km).sort((a, b) => a - b);
    expect(km).toEqual([50, 100]);
  });

  it('距離も時間も無い記録は入れない', () => {
    const empty: ImportedWorkout = {
      externalId: 'file:none',
      startedAt: '2026-09-22T00:01:00Z',
      type: 'run',
      source: 'file',
    };
    expect(importWorkouts(base(), [empty], NOW).imported).toBe(0);
  });

  it('あり得ない心拍は、そのまま入れない', () => {
    const odd: ImportedWorkout = { ...run('file:1', '2026-09-22T00:01:00Z', 10000, 3000), avgHr: 900 };
    const result = importWorkouts(base(), [odd], NOW);
    expect(result.profile.activities[0].metrics?.avgHr).toBeUndefined();
  });
});

describe('取り込みの知らせ方', () => {
  const profile = applyProfileUpdate(createDefaultProfile('u1'), { displayName: 'ケント' }, NOW);

  it('入った数を言う', () => {
    expect(describeImport({ profile, imported: 3, skipped: 0 })).toContain('3件');
  });

  it('全部すでに入っていたなら、そう言う', () => {
    expect(describeImport({ profile, imported: 0, skipped: 4 })).toContain('すべて取り込み済み');
  });

  it('1件も読めなかった時に、入ったふりをしない', () => {
    expect(describeImport({ profile, imported: 0, skipped: 0 })).toContain('見つかりませんでした');
  });
});
