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

  /**
   * 区間の平均ペース(秒/km)。
   * **本数で割らない。** 距離の違う区間が混ざっていると、それでは実際とずれる。
   */
  const lapKm = laps.reduce((sum, lap) => sum + lap.distanceKm, 0);
  const lapSec = laps.reduce((sum, lap) => sum + lap.durationSec, 0);
  const meanPace = lapKm > 0 ? lapSec / lapKm : 0;

  /** 区間の距離が揃っているか。揃っているなら、同じ数字を何十行も並べない。 */
  const evenLaps =
    laps.length > 0 && laps.every((lap) => Math.abs(lap.distanceKm - laps[0].distanceKm) <= 0.05);

  const paceOf = (lap: (typeof laps)[number]) =>
    lap.distanceKm > 0 ? lap.durationSec / lap.distanceKm : 0;

  /** 棒の長さは速さに比例させる。速い区間が長く出るので、繰り返しの形が一目で分かる。 */
  const barWidth = (pace: number) => {
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
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[13px] font-semibold">区間</p>
            <p className="text-[11px] text-muted tabular-nums">
              {evenLaps ? `${laps[0].distanceKm.toFixed(2)}km ごと・` : ''}
              {laps.length}本
            </p>
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
            棒が長いほど速い区間です。
            <strong className="font-semibold text-fg">縦の線が、この練習の平均ペース。</strong>
            線より右へ出ていれば、平均より速い区間です。
          </p>

          {/*
            **どの数字が何なのかを、必ず名前で言う。**
            数字だけが4列並んでいると、距離なのかペースなのか心拍なのかが読めない。
          */}
          <div className="mt-2 flex items-center gap-2 border-b border-line pb-1 text-[10px] text-muted">
            <span className="w-5 shrink-0 text-right">#</span>
            {!evenLaps && <span className="w-10 shrink-0">km</span>}
            <span className="min-w-0 flex-1">速さ</span>
            <span className="w-[72px] shrink-0 text-right">ペース</span>
            <span className="w-8 shrink-0 text-right">心拍</span>
          </div>

          <ul className="mt-1 space-y-1">
            {laps.map((lap) => {
              const pace = paceOf(lap);
              // 平均との差(秒/km)。**「速かった」を言葉ではなく数で出す。**
              const diff = pace > 0 && meanPace > 0 ? Math.round(pace - meanPace) : 0;
              const faster = pace > 0 && pace <= meanPace;

              return (
                <li key={lap.index} className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-right text-[11px] text-muted tabular-nums">
                    {lap.index}
                  </span>
                  {!evenLaps && (
                    <span className="w-10 shrink-0 text-[11px] text-muted tabular-nums">
                      {lap.distanceKm.toFixed(2)}
                    </span>
                  )}
                  <span className="relative block min-w-0 flex-1">
                    <span
                      className={`block h-4 rounded-sm ${faster ? 'bg-accent' : 'bg-accent/35'}`}
                      style={{ width: `${barWidth(pace)}%` }}
                    />
                    {/* 平均の位置。全部の行で同じ場所に立つので、上下に見比べられる。 */}
                    <span
                      className="absolute top-[-2px] h-[20px] w-px bg-fg/45"
                      style={{ left: `${barWidth(meanPace)}%` }}
                    />
                  </span>
                  <span className="w-[72px] shrink-0 text-right text-[11px] tabular-nums">
                    <span className="font-semibold">{lap.pace?.replace('/km', '') ?? '—'}</span>
                    {diff !== 0 && (
                      <span className="ml-1 text-[10px] text-muted">
                        {diff > 0 ? `+${diff}` : diff}
                      </span>
                    )}
                  </span>
                  <span className="w-8 shrink-0 text-right text-[11px] text-muted tabular-nums">
                    {lap.avgHr ?? ''}
                  </span>
                </li>
              );
            })}
          </ul>

          <p className="mt-1.5 text-[10px] leading-relaxed text-muted">
            ペースの右の小さな数字は、平均との差（秒/km）です。マイナスが速いほう。
          </p>
        </div>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-muted">
        ここに出ている数値は、時計が測ったものをそのまま計算しています。
        コーチもこの区間の並びを見て答えます。
      </p>
    </Sheet>
  );
}
