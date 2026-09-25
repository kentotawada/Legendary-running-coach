'use client';

import type { ActivityLog } from '@/lib/types';
import { analyze } from '@/lib/analysis';
import Sheet from './Sheet';

/**
 * 1本の練習の中身を見る画面。
 *
 * **平均だけを見せない。** 同じ「平均4分00秒」でも、
 * 1本目から突っ込んで最後に垂れた走りと、最後まで刻んだ走りは別物で、
 * 次にやるべきことも変わる。その違いが、ここで目に見えるようにする。
 *
 * 作りの方針は `ReviewCharts.tsx` と揃える。
 * 軸は1本、線は細く、値はグラフの外からも読めるようにする。
 */

const WIDTH = 320;
const PLOT_HEIGHT = 96;

const SHAPE_LABEL: Record<string, string> = {
  steady: '一定ペース',
  intervals: 'インターバル',
  progression: 'ビルドアップ',
  fade: '後半に落ちている',
  unknown: '—',
};

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-[14px] bg-sunken px-3 py-2.5">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-0.5 truncate text-[15px] font-bold tabular-nums">{value}</p>
      {note && <p className="mt-0.5 truncate text-[10px] text-muted">{note}</p>}
    </div>
  );
}

/** 心拍の推移。距離を横軸に取る（時間だと、止まった時間で形が歪む）。 */
function HeartRateChart({ km, hr }: { km: number[]; hr: (number | null)[] }) {
  const points = km
    .map((distance, index) => ({ distance, value: hr[index] }))
    .filter((point): point is { distance: number; value: number } => point.value !== null);
  if (points.length < 2) return null;

  const maxKm = Math.max(...points.map((point) => point.distance), 0.1);
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);

  const path = points
    .map((point, index) => {
      const x = (point.distance / maxKm) * WIDTH;
      const y = PLOT_HEIGHT - ((point.value - min) / span) * PLOT_HEIGHT;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between">
        <p className="text-[13px] font-semibold">心拍の推移</p>
        <p className="text-[11px] text-muted tabular-nums">
          {min} 〜 {max} bpm
        </p>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${PLOT_HEIGHT}`}
        className="mt-1.5 w-full"
        role="img"
        aria-label={`心拍の推移。${min}から${max}bpm。`}
        preserveAspectRatio="none"
        style={{ height: PLOT_HEIGHT }}
      >
        {[0, 0.5, 1].map((ratio) => (
          <line
            key={ratio}
            x1={0}
            x2={WIDTH}
            y1={PLOT_HEIGHT * ratio}
            y2={PLOT_HEIGHT * ratio}
            stroke="var(--chart-grid)"
            strokeWidth={1}
            shapeRendering="crispEdges"
          />
        ))}
        <path d={path} fill="none" stroke="var(--chart-ink)" strokeWidth={1.6} strokeLinejoin="round" />
      </svg>
      <div className="flex justify-between text-[10px] text-muted tabular-nums">
        <span>0km</span>
        <span>{maxKm.toFixed(1)}km</span>
      </div>
    </div>
  );
}

export default function RunSheet({ activity, onClose }: { activity: ActivityLog; onClose: () => void }) {
  const laps = activity.laps ?? [];
  const analysis = analyze(activity);

  const paces = laps
    .map((lap) => (lap.distanceKm > 0 ? lap.durationSec / lap.distanceKm : 0))
    .filter((pace) => pace > 0);
  const fastest = paces.length > 0 ? Math.min(...paces) : 0;
  const slowest = paces.length > 0 ? Math.max(...paces) : 0;

  /** 棒の長さは速さに比例させる。速い区間が長く出るので、繰り返しの形が一目で分かる。 */
  const barWidth = (lap: (typeof laps)[number]) => {
    const pace = lap.distanceKm > 0 ? lap.durationSec / lap.distanceKm : 0;
    if (pace <= 0 || slowest === fastest) return 100;
    return 30 + ((slowest - pace) / (slowest - fastest)) * 70;
  };

  return (
    <Sheet label="練習の中身" title={`${activity.date} の練習`} onClose={onClose}>
      <div className="flex gap-2">
        <Tile
          label="距離"
          value={activity.distanceKm !== undefined ? `${activity.distanceKm}km` : '—'}
          note={activity.durationMin !== undefined ? `${activity.durationMin}分` : undefined}
        />
        <Tile label="平均ペース" value={activity.metrics?.avgPace ?? '—'} />
        <Tile
          label="平均心拍"
          value={activity.metrics?.avgHr !== undefined ? `${activity.metrics.avgHr}` : '—'}
          note={activity.metrics?.maxHr !== undefined ? `最高 ${activity.metrics.maxHr}` : undefined}
        />
      </div>

      {/* 3つ並べると「インターバル」が切れる。2つにして、心拍は注釈へ回す。 */}
      {analysis && (
        <div className="mt-2 flex gap-2">
          <Tile
            label="形"
            value={SHAPE_LABEL[analysis.shape] ?? '—'}
            note={
              analysis.paceFadeSec !== undefined && analysis.paceFadeSec !== 0
                ? analysis.paceFadeSec > 0
                  ? `後半 ${analysis.paceFadeSec}秒/km 遅い`
                  : `後半 ${-analysis.paceFadeSec}秒/km 速い`
                : undefined
            }
          />
          <Tile
            label="心拍ドリフト"
            value={
              analysis.decouplingPercent !== undefined
                ? `${analysis.decouplingPercent > 0 ? '+' : ''}${analysis.decouplingPercent}%`
                : '—'
            }
            note={
              analysis.firstHalfHr !== undefined && analysis.secondHalfHr !== undefined
                ? `前半 ${analysis.firstHalfHr} → 後半 ${analysis.secondHalfHr}`
                : '同じ速度に対して'
            }
          />
        </div>
      )}

      {analysis?.reps && (
        <p className="mt-2 rounded-[14px] border border-[color:var(--accent)] bg-accent-soft px-3.5 py-2.5 text-[13px] leading-relaxed text-accent">
          速い区間 <strong className="font-bold">{analysis.reps.count}本</strong> / 平均{' '}
          <strong className="font-bold">{analysis.reps.pace}</strong>
          {analysis.reps.avgHr !== undefined && ` / 平均心拍 ${analysis.reps.avgHr}`}
          {analysis.reps.restPace && ` / つなぎ ${analysis.reps.restPace}`}
        </p>
      )}

      {activity.series && <HeartRateChart km={activity.series.km} hr={activity.series.hr} />}

      {laps.length > 1 && (
        <div className="mt-5">
          <p className="text-[13px] font-semibold">区間</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
            棒が長いほど速い区間です。時計が切ったラップ、無ければ1kmごとの区切りです。
          </p>
          <ul className="mt-2 space-y-1">
            {laps.map((lap) => (
              <li key={lap.index} className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-right text-[11px] text-muted tabular-nums">
                  {lap.index}
                </span>
                <span className="w-12 shrink-0 text-[11px] text-muted tabular-nums">
                  {lap.distanceKm.toFixed(2)}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className="block h-4 rounded-sm bg-accent"
                    style={{ width: `${barWidth(lap)}%` }}
                  />
                </span>
                <span className="w-16 shrink-0 text-right text-[11px] font-semibold tabular-nums">
                  {lap.pace?.replace('/km', '') ?? '—'}
                </span>
                <span className="w-9 shrink-0 text-right text-[11px] text-muted tabular-nums">
                  {lap.avgHr ?? ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-muted">
        ここに出ている数値は、時計が測ったものをそのまま計算しています。
        コーチもこの区間の並びを見て答えます。
      </p>
    </Sheet>
  );
}
