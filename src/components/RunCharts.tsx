'use client';

import { useMemo, useState } from 'react';
import type { ActivitySeries } from '@/lib/types';
import { formatPace } from '@/lib/goals';

/**
 * 1本の練習の推移。
 *
 * 作りの方針:
 *  - **1つのグラフに軸は1つ。** 心拍とペースを重ねると、無い相関が見えてしまう。
 *    項目ごとに小さなグラフを縦に並べ、横軸だけを共有する。
 *  - **触った位置は全部のグラフで揃う。** 「5km地点で心拍が上がった時、
 *    ピッチはどうだったか」は、同じ瞬間を横断して見ないと答えられない。
 *  - 1項目1本なので凡例は置かない。見出しがその名前になっている。
 *  - 値はグラフの外（見出しの右）からも読める。触らないと読めない値は、読めない値と同じ。
 */

const WIDTH = 320;
const PLOT_HEIGHT = 58;

export type Axis = 'time' | 'distance';

interface Metric {
  key: string;
  label: string;
  unit: string;
  values: (number | null)[];
  /**
   * 軸を上下ひっくり返す。
   *
   * **ペースだけ。** 「速い方が上」は走る人の共通了解なので、そのほうが読みやすい。
   * 上下動や接地時間まで裏返すと、**数値が増えたのに線が下がる**ことになり、
   * 時計の画面と見比べた時に必ず混乱する。小さいほど良い項目でも、そのまま描く。
   */
  inverted?: boolean;
  /** 値の書き方。 */
  format?: (value: number) => string;
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = `${Math.round(seconds) % 60}`.padStart(2, '0');
  return m >= 60 ? `${Math.floor(m / 60)}:${`${m % 60}`.padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** 測れていない点で線を切る。繋ぐと、そこに値があったことになってしまう。 */
function pathOf(values: (number | null)[], xs: number[], min: number, span: number): string {
  let path = '';
  let pen = false;
  values.forEach((value, index) => {
    if (value === null) {
      pen = false;
      return;
    }
    const x = xs[index];
    const y = PLOT_HEIGHT - ((value - min) / span) * PLOT_HEIGHT;
    path += `${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    pen = true;
  });
  return path;
}

function Chart({
  metric,
  xs,
  at,
  onHover,
}: {
  metric: Metric;
  xs: number[];
  at: number | null;
  onHover: (index: number | null) => void;
}) {
  const numbers = metric.values.filter((value): value is number => value !== null);
  if (numbers.length < 2) return null;

  const low = Math.min(...numbers);
  const high = Math.max(...numbers);
  const span = Math.max(high - low, 1);
  // 小さいほど良い項目は、上下をひっくり返す。速い方が上に来るほうが読みやすい。
  const plot = metric.inverted ? metric.values.map((v) => (v === null ? null : high + low - v)) : metric.values;
  const path = pathOf(plot, xs, low, span);

  const show = metric.format ?? ((value: number) => `${Math.round(value)}`);
  const current = at !== null ? metric.values[at] : null;
  const headline = current !== null && current !== undefined ? show(current) : `${show(low)}〜${show(high)}`;

  const pointY = (() => {
    if (at === null) return null;
    const value = plot[at];
    if (value === null || value === undefined) return null;
    return PLOT_HEIGHT - ((value - low) / span) * PLOT_HEIGHT;
  })();

  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between">
        <p className="text-[12px] font-semibold">{metric.label}</p>
        <p className="text-[12px] tabular-nums">
          <span className={current !== null && current !== undefined ? 'font-bold' : 'text-muted'}>
            {headline}
          </span>
          <span className="ml-0.5 text-[10px] text-muted">{metric.unit}</span>
        </p>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${PLOT_HEIGHT}`}
        className="mt-1 w-full touch-none"
        style={{ height: PLOT_HEIGHT }}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${metric.label}の推移。${show(low)}から${show(high)}${metric.unit}。`}
        onPointerDown={(event) => onHover(indexAt(event, xs))}
        onPointerMove={(event) => event.buttons !== 0 && onHover(indexAt(event, xs))}
        onPointerLeave={() => onHover(null)}
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
        <path d={path} fill="none" stroke="var(--chart-ink)" strokeWidth={2} strokeLinejoin="round" />
        {at !== null && (
          <line
            x1={xs[at]}
            x2={xs[at]}
            y1={0}
            y2={PLOT_HEIGHT}
            stroke="var(--chart-ink)"
            strokeWidth={1}
            opacity={0.5}
          />
        )}
        {pointY !== null && (
          <circle cx={xs[at!]} cy={pointY} r={3.5} fill="var(--chart-ink)" stroke="var(--bg-elevated)" strokeWidth={2} />
        )}
      </svg>
    </div>
  );
}

/** 触った位置に、いちばん近い点。 */
function indexAt(event: React.PointerEvent<SVGSVGElement>, xs: number[]): number {
  const box = event.currentTarget.getBoundingClientRect();
  const ratio = box.width > 0 ? (event.clientX - box.left) / box.width : 0;
  const x = Math.min(WIDTH, Math.max(0, ratio * WIDTH));
  let best = 0;
  for (let i = 1; i < xs.length; i += 1) {
    if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
  }
  return best;
}

export default function RunCharts({ series }: { series: ActivitySeries }) {
  const [axis, setAxis] = useState<Axis>('distance');
  const [at, setAt] = useState<number | null>(null);

  const hasDistance = series.km.some((value) => value > 0);
  const useDistance = axis === 'distance' && hasDistance;
  const source = useDistance ? series.km : series.t;

  // 横軸の値を、描く位置に直す。**時間で等間隔に描かない。**
  // 止まっていた時間があると、距離で見た形が歪む。
  const xs = useMemo(() => {
    const max = Math.max(...source, 0.001);
    const min = Math.min(...source, 0);
    const width = Math.max(max - min, 0.001);
    return source.map((value) => ((value - min) / width) * WIDTH);
  }, [source]);

  const metrics: Metric[] = [
    { key: 'pace', label: 'ペース', unit: '/km', values: series.pace ?? [], inverted: true, format: (v) => formatPace(v).replace('/km', '') },
    { key: 'hr', label: '心拍', unit: 'bpm', values: series.hr },
    { key: 'cadence', label: 'ピッチ', unit: 'spm', values: series.cadence ?? [] },
    { key: 'power', label: 'パワー', unit: 'W', values: series.power ?? [] },
    { key: 'vo', label: '上下動', unit: 'cm', values: series.vo ?? [], format: (v) => v.toFixed(1) },
    { key: 'gct', label: '接地時間', unit: 'ms', values: series.gct ?? [] },
  ];
  const shown = metrics.filter((metric) => metric.values.some((value) => value !== null));
  if (shown.length === 0) return null;

  const total = useDistance
    ? `${(series.km[series.km.length - 1] ?? 0).toFixed(2)}km`
    : clock(series.t[series.t.length - 1] ?? 0);
  const here = at !== null ? (useDistance ? `${series.km[at].toFixed(2)}km` : clock(series.t[at])) : null;

  return (
    <div className="mt-5">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[13px] font-semibold">
          走っている間の推移
          {here && <span className="ml-1.5 font-normal text-accent tabular-nums">{here}</span>}
        </p>
        {/* 横軸の切り替え。グラフの上に1列だけ置く。 */}
        <div className="flex shrink-0 overflow-hidden rounded-full border border-line text-[11px]">
          {(['distance', 'time'] as Axis[]).map((value) => (
            <button
              key={value}
              type="button"
              disabled={value === 'distance' && !hasDistance}
              onClick={() => {
                setAxis(value);
                setAt(null);
              }}
              className={`px-2.5 py-1 font-medium disabled:opacity-30 ${
                (useDistance ? 'distance' : 'time') === value ? 'bg-accent text-[var(--accent-fg)]' : 'text-muted'
              }`}
            >
              {value === 'distance' ? '距離' : '時間'}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
        グラフを触ると、その地点の値が
        <strong className="font-semibold text-fg">すべての項目で</strong>揃って出ます。
      </p>

      {shown.map((metric) => (
        <Chart key={metric.key} metric={metric} xs={xs} at={at} onHover={setAt} />
      ))}

      <div className="mt-1 flex justify-between text-[10px] text-muted tabular-nums">
        <span>{useDistance ? '0km' : '0:00'}</span>
        <span>{total}</span>
      </div>
    </div>
  );
}
