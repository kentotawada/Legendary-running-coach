'use client';

import type { ActivityLog } from '@/lib/types';
import { analyze } from '@/lib/analysis';
import RunCharts from './RunCharts';
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

export default function RunSheet({
  activity,
  onClose,
  onBack,
}: {
  activity: ActivityLog;
  onClose: () => void;
  /** カルテから開かれた時だけ渡す。閉じたらカルテへ戻す。 */
  onBack?: () => void;
}) {
  const laps = activity.laps ?? [];
  const analysis = analyze(activity);

  const paces = laps
    .map((lap) => (lap.distanceKm > 0 ? lap.durationSec / lap.distanceKm : 0))
    .filter((pace) => pace > 0);
  const fastest = paces.length > 0 ? Math.min(...paces) : 0;
  const slowest = paces.length > 0 ? Math.max(...paces) : 0;

  const metrics = activity.metrics;
  const form = [
    metrics?.powerW !== undefined ? { label: 'パワー', value: `${metrics.powerW}W` } : null,
    metrics?.verticalOscillationCm !== undefined
      ? { label: '上下動', value: `${metrics.verticalOscillationCm}cm` }
      : null,
    metrics?.groundContactMs !== undefined
      ? { label: '接地時間', value: `${metrics.groundContactMs}ms` }
      : null,
    metrics?.stepLengthCm !== undefined ? { label: '歩幅', value: `${metrics.stepLengthCm}cm` } : null,
    metrics?.verticalRatio !== undefined ? { label: '上下動比', value: `${metrics.verticalRatio}%` } : null,
    metrics?.balanceLeft !== undefined
      ? {
          label: '左右',
          value: `${metrics.balanceLeft} : ${Math.round((100 - metrics.balanceLeft) * 10) / 10}`,
        }
      : null,
  ].filter((item): item is { label: string; value: string } => item !== null);

  /** 棒の長さは速さに比例させる。速い区間が長く出るので、繰り返しの形が一目で分かる。 */
  const barWidth = (lap: (typeof laps)[number]) => {
    const pace = lap.distanceKm > 0 ? lap.durationSec / lap.distanceKm : 0;
    if (pace <= 0 || slowest === fastest) return 100;
    return 30 + ((slowest - pace) / (slowest - fastest)) * 70;
  };

  return (
    <Sheet
      label="練習の中身"
      title={`${activity.date} の練習`}
      onClose={onClose}
      onBack={onBack}
      backLabel={onBack ? 'カルテ' : undefined}
    >
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

      {/*
        フォームの指標は FIT ファイルからしか入らない。
        良し悪しの目安は身長や速度で変わるので、**判定は書かない。** 数値だけを置く。
      */}
      {form.length > 0 && (
        <div className="mt-4">
          <p className="text-[13px] font-semibold">フォームの指標</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {form.map((item) => (
              <span
                key={item.label}
                className="rounded-full border border-line px-3 py-1.5 text-[12px] tabular-nums"
              >
                <span className="text-muted">{item.label}</span>{' '}
                <strong className="font-bold">{item.value}</strong>
              </span>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            良し悪しの目安は、身長や走る速度で変わります。見るのは、自分の中での変化です。
          </p>
        </div>
      )}

      {activity.series && <RunCharts series={activity.series} />}

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
