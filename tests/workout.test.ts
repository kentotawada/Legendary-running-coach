import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, WorkoutFileError, parseWorkoutFile } from '@/lib/workout-file';
import {
  KEEP_SERIES,
  MAX_SERIES_POINTS,
  describeImport,
  importWorkouts,
  normalizeCadence,
  toActivity,
  type ImportedWorkout,
} from '@/lib/workout';
import { analyze } from '@/lib/analysis';
import { addActivity, addShoes, applyProfileUpdate } from '@/lib/profile';
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
  it('壊れた FIT は、読めなかったと言う', () => {
    const broken = new Uint8Array([1, 2, 3, 4]).buffer;
    expect(() => parseWorkoutFile('activity.fit', broken)).toThrow(WorkoutFileError);
  });

  /** 「読めませんでした」だけでは、どれが悪いのか分からない。名前を必ず出す。 */
  it('関係のないファイルは、名前を挙げてそう言う', () => {
    expect(() => parseWorkoutFile('memo.txt', 'こんにちは')).toThrow(/memo\.txt/);
    expect(() => parseWorkoutFile('memo.txt', 'こんにちは')).toThrow(/FIT・TCX・GPX/);
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

  it('入った数を言う', () => {
    expect(describeImport({ imported: 3, skipped: 0, upgraded: 0 })).toContain('3件');
  });

  it('全部すでに入っていたなら、そう言う', () => {
    expect(describeImport({ imported: 0, skipped: 4, upgraded: 0 })).toContain('すべて取り込み済み');
  });

  /** 差し替えを黙っていると、押したのに何も起きていないように見える。 */
  it('より詳しい記録に差し替えた時は、そう言う', () => {
    const text = describeImport({ imported: 0, skipped: 0, upgraded: 2 });
    expect(text).toContain('2件');
    expect(text).toContain('差し替え');
  });

  it('1件も読めなかった時に、入ったふりをしない', () => {
    expect(describeImport({ imported: 0, skipped: 0, upgraded: 0 })).toContain('見つかりませんでした');
  });
});

/** 緯度1度ぶんのおおよその距離(m)。試験用の座標を作るのに使う。 */
const METERS_PER_DEGREE = 111_194.9;

/** 一定ペースで一直線に進む GPX を作る。 */
function gpxRun(options: { points: number; stepM: number; stepSec: number; hrFrom: number; hrTo: number }) {
  const { points, stepM, stepSec, hrFrom, hrTo } = options;
  const start = Date.parse('2026-09-22T00:00:00.000Z');
  const body = Array.from({ length: points }, (_, i) => {
    const lat = 35 + (i * stepM) / METERS_PER_DEGREE;
    const hr = Math.round(hrFrom + ((hrTo - hrFrom) * i) / (points - 1));
    const iso = new Date(start + i * stepSec * 1000).toISOString();
    return `<trkpt lat="${lat.toFixed(7)}" lon="139.0000000"><ele>10.0</ele><time>${iso}</time>` +
      `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${hr}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>`;
  }).join('');
  return `<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><type>running</type><trkseg>${body}</trkseg></trk></gpx>`;
}

describe('走っている途中の中身を残す', () => {
  // 3km を キロ5分で。50m ごとに1点（15秒ごと）。
  const xml = gpxRun({ points: 61, stepM: 50, stepSec: 15, hrFrom: 140, hrTo: 170 });
  const [workout] = parseWorkoutFile('run.gpx', xml);

  it('1点ずつの推移を持って帰る', () => {
    expect(workout.samples).toHaveLength(61);
    expect(workout.samples![0].hr).toBe(140);
    expect(workout.samples![60].hr).toBe(170);
  });

  /**
   * GPX にラップは無い。**区間に切らないと、コーチが読める形にならない。**
   * 「5km目で心拍が上がり始めた」は、切って初めて言葉にできる。
   */
  it('ラップが無いファイルでも、1kmごとに切り出す', () => {
    const activity = toActivity(workout)!;
    expect(activity.laps).toHaveLength(3);
    expect(activity.laps![0].distanceKm).toBeCloseTo(1, 1);
    expect(activity.laps![0].pace).toBe('5:00/km');
    // 心拍は区間ごとに上がっていく
    expect(activity.laps![2].avgHr!).toBeGreaterThan(activity.laps![0].avgHr!);
  });

  it('推移は間引いて持つ。最後の点は必ず残す', () => {
    const series = toActivity(workout)!.series!;
    expect(series.t.length).toBeLessThanOrEqual(MAX_SERIES_POINTS);
    expect(series.t[series.t.length - 1]).toBe(900);
    expect(series.hr[series.hr.length - 1]).toBe(170);
  });

  it('区間の並びから、心拍ドリフトが出る', () => {
    const mapped = toActivity(workout)!;
    const analysis = analyze({ ...mapped, id: 'a1', createdAt: NOW.toISOString() })!;
    expect(analysis.shape).toBe('steady');
    // 同じペースで心拍だけ上がっている
    expect(analysis.decouplingPercent!).toBeGreaterThan(5);
  });
});

describe('時計が切ったラップ', () => {
  const [workout] = parseWorkoutFile('activity.tcx', TCX);

  it('ラップをそのまま残す', () => {
    expect(workout.laps).toHaveLength(2);
    expect(workout.laps![0]).toMatchObject({ distanceM: 9000, durationSec: 1800, avgHr: 150 });
  });

  it('カルテにも区間として入る', () => {
    const activity = toActivity(workout)!;
    expect(activity.laps).toHaveLength(2);
    expect(activity.laps![0].pace).toBe('3:20/km');
    expect(activity.laps![1].avgHr).toBe(160);
  });
});

describe('推移をいつまで持つか', () => {
  /**
   * 記録は毎回ブラウザまで運ばれる。全部に推移を持たせると、半年で目に見えて重くなる。
   * **ラップは全部残す。** 軽い上に、後から効く。
   */
  it('古い練習の推移は落とし、ラップは残す', () => {
    let profile = createDefaultProfile('u1', NOW.toISOString());
    for (let i = 0; i < KEEP_SERIES + 4; i += 1) {
      const day = `${10 + i}`.padStart(2, '0');
      const xml = gpxRun({ points: 41, stepM: 50, stepSec: 15, hrFrom: 140, hrTo: 160 }).replace(
        /2026-09-22/g,
        `2026-08-${day}`,
      );
      const [parsed] = parseWorkoutFile('run.gpx', xml);
      profile = importWorkouts(profile, [parsed], NOW).profile;
    }

    const withSeries = profile.activities.filter((activity) => activity.series);
    const withLaps = profile.activities.filter((activity) => activity.laps);
    expect(profile.activities).toHaveLength(KEEP_SERIES + 4);
    expect(withSeries).toHaveLength(KEEP_SERIES);
    expect(withLaps).toHaveLength(KEEP_SERIES + 4);
  });
});

describe('並び順', () => {
  /**
   * 追加した順に並べていると、**古いファイルを後から取り込んだ瞬間に順番が崩れる。**
   * カルテの見た目だけの問題ではない。コーチにも同じ順で渡るので、
   * 直近の練習を取り違えたまま指導することになる。
   */
  it('後から古い練習を入れても、走った日の順に並ぶ', () => {
    let profile = createDefaultProfile('u1', NOW.toISOString());
    profile = importWorkouts(profile, [run('file:24', '2026-09-24T00:00:00Z', 6200, 1574)], NOW).profile;
    profile = importWorkouts(profile, [run('file:18', '2026-09-18T00:00:00Z', 5000, 1320)], NOW).profile;
    profile = importWorkouts(profile, [run('file:22', '2026-09-22T00:00:00Z', 18070, 4560)], NOW).profile;

    expect(profile.activities.map((activity) => activity.date)).toEqual([
      '2026-09-18',
      '2026-09-22',
      '2026-09-24',
    ]);
  });

  it('同じ日に2本走った時は、記録した順を保つ', () => {
    let profile = createDefaultProfile('u1', NOW.toISOString());
    profile = importWorkouts(
      profile,
      [
        run('file:am', '2026-09-22T00:00:00Z', 10000, 2400),
        run('file:pm', '2026-09-22T10:00:00Z', 6000, 1800),
      ],
      NOW,
    ).profile;
    expect(profile.activities.map((activity) => activity.distanceKm)).toEqual([10, 6]);
  });
});

describe('より詳しい記録が来た時', () => {
  /** チャットで話した練習を、後からファイルで取り込む流れ。 */
  const chatLogged = () => {
    const profile = createDefaultProfile('u1', NOW.toISOString());
    return addActivity(
      profile,
      {
        date: '2026-09-24',
        type: 'run',
        distanceKm: 6.2,
        durationMin: 26,
        felt: '膝の痛みなし。肘の引きを意識した',
        effort: 7,
      },
      NOW,
    );
  };

  const fromFile = (): ImportedWorkout => ({
    externalId: 'file:2026-09-24T00:06:00Z',
    startedAt: '2026-09-24T00:06:00Z',
    type: 'run',
    distanceM: 6120,
    durationSec: 1574,
    avgHr: 167,
    source: 'file',
    laps: Array.from({ length: 6 }, () => ({ distanceM: 1000, durationSec: 257, avgHr: 167 })),
    samples: Array.from({ length: 40 }, (_, i) => ({ t: i * 40, d: i * 153, hr: 160 + (i % 10) })),
  });

  it('弾かずに、詳しいほうへ差し替える', () => {
    const result = importWorkouts(chatLogged(), [fromFile()], NOW);

    expect(result.imported).toBe(0);
    expect(result.upgraded).toBe(1);
    expect(result.skipped).toBe(0);
    // 二重に増えない
    expect(result.profile.activities).toHaveLength(1);

    const activity = result.profile.activities[0];
    expect(activity.laps).toHaveLength(6);
    expect(activity.series).toBeTruthy();
    expect(activity.metrics?.avgHr).toBe(167);
  });

  /** どう感じたかは時計には測れない。こちらのほうが価値が高い。 */
  it('本人の言葉は、差し替えても残す', () => {
    const activity = importWorkouts(chatLogged(), [fromFile()], NOW).profile.activities[0];
    expect(activity.felt).toContain('膝の痛みなし');
    expect(activity.effort).toBe(7);
  });

  it('同じ詳しさのものが来たら、差し替えない', () => {
    const once = importWorkouts(chatLogged(), [fromFile()], NOW);
    const twice = importWorkouts(once.profile, [fromFile()], NOW);
    expect(twice.upgraded).toBe(0);
    expect(twice.skipped).toBe(1);
    expect(twice.profile.activities).toHaveLength(1);
  });
});
