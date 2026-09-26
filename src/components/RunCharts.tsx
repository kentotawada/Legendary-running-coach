'use client';

import { useMemo, useState } from 'react';
import type { ActivitySeries } from '@/lib/types';
import { formatPace } from '@/lib/goals';

/**
 * 1本の練習の推移。
 *
 * **時計の画面と同じ形に揃えてある。** 見比べる相手が決まっているものは、
 * 独自の見せ方をするほど読みにくくなる。並びはこう:
 *
 *   見出し / 大きな数字（平均・最大）/ 縦軸つきのグラフ / 横軸の目盛り / 軸の名前
 *
 *  - **1つのグラフに軸は1つ。** 心拍とペースを重ねると、無い相関が見えてしまう。
 *  - **触った位置は全部のグラフで揃う。** 「5km地点で心拍が上がった時、
 *    ピッチはどうだったか」は、同じ瞬間を横断して見ないと答えられない。
 *  - 1項目1本なので凡例は置かない。見出しがその名前になっている。
 *  - 色は項目ごとに変える。7段を行き来する時、色が目印になる。
 */

const WIDTH = 320;
const PLOT_HEIGHT = 108;

/** 横軸に置く目盛りの数。時計の画面と同じ6つ。 */
const X_TICKS = 6;

/**
 * 1時間を超える練習では、目盛りを減らす。
 * **「1:12:00」は「18:00」の倍の幅がある。** 6つのままだと端の2つが重なって読めない。
 */
const X_TICKS_LONG = 4;

/** 縦軸の目盛りの本数（区切りの数）。多いと数字だらけになる。 */
const Y_STEPS = 4;

export type Axis = 'time' | 'distance';

interface Metric {
  key: string;
  label: string;
  unit: string;
  /** 項目の色。globals.css で検証済みの並びから取る。 */
  color: string;
  values: (number | null)[];
  /**
   * 軸を上下ひっくり返す。
   *
   * **ペースだけ。** 「速い方が上」は走る人の共通了解なので、そのほうが読みやすい。
   * 上下動や接地時間まで裏返すと、**数値が増えたのに線が下がる**ことになり、
   * 時計の画面と見比べた時に必ず混乱する。小さいほど良い項目でも、そのまま描く。
   */
  inverted?: boolean;
  /**
   * 平均の出し方が、点の足し算では合わない項目だけ渡す。
   *
   * **ペースがそれ。** 1点ごとのペースをただ足して割ると、
   * ゆっくり走った時間の重みが軽くなり、全体の平均ペースとずれる。
   * 同じ画面に「平均ペース 5:13」と「平均 5:16」が並ぶことになり、
   * どちらが本当なのか分からなくなる。
   */
  mean?: number;
  /** 2つめの大きな数字。最大が意味を持つ項目にだけ置く。 */
  extra?: 'max' | 'best';
  /** 縦軸の刻みの候補。単位ごとに、人が使っている刻みがある。 */
  ySteps?: number[];
  /** 値の書き方。 */
  format?: (value: number) => string;
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = `${Math.round(seconds) % 60}`.padStart(2, '0');
  return m >= 60 ? `${Math.floor(m / 60)}:${`${m % 60}`.padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** 1・2・2.5・5 の刻み。人が数えやすい数だけを使う。 */
const LADDER = [1, 2, 2.5, 5];

function pickStep(span: number, steps: number[] | undefined, want: number): number {
  if (steps) return steps.find((candidate) => span / candidate <= want) ?? steps[steps.length - 1];
  if (!(span > 0)) return 1;

  const magnitude = 10 ** Math.floor(Math.log10(span / want));
  for (const factor of LADDER) {
    if (span / (factor * magnitude) <= want) return factor * magnitude;
  }
  return 10 * magnitude;
}

/**
 * 縦軸。
 *
 * **目盛りの数に、軸の端を合わせる。** データの最小・最大をそのまま端にすると、
 * 目盛りが半端な位置に立ち、いくつの線なのか読めない。
 * きりの良い値まで外へ広げてから、その間を刻む。
 */
export function axisFor(
  low: number,
  high: number,
  steps?: number[],
): { base: number; span: number; ticks: number[] } {
  const step = pickStep(high - low, steps, Y_STEPS);
  let base = Math.floor(low / step) * step;
  let top = Math.ceil(high / step) * step;
  // ずっと同じ値だった項目は、上下に1つずつ広げて真ん中に置く。
  if (top - base < step * 0.5) {
    base -= step;
    top += step;
  }

  const ticks: number[] = [];
  for (let value = base; value <= top + step * 1e-6; value += step) {
    ticks.push(Math.round(value * 1000) / 1000);
  }
  return { base, span: top - base, ticks };
}

/**
 * 横軸の目盛り。
 * **等間隔に割る。** 時計の画面がそうなっているので、同じ形に揃える。
 */
export function xTicksFor(min: number, max: number, count = X_TICKS): number[] {
  if (!(max > min)) return [min];
  return Array.from({ length: count }, (_, i) => min + ((max - min) * i) / (count - 1));
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

/** 線の下を塗る面。切れ目ごとに閉じるので、測れていない区間は塗らない。 */
function areaOf(values: (number | null)[], xs: number[], min: number, span: number): string {
  let path = '';
  let from: number | null = null;
  let previous = 0;

  values.forEach((value, index) => {
    const x = xs[index];
    if (value === null) {
      if (from !== null) path += `L${previous.toFixed(1)},${PLOT_HEIGHT} L${from.toFixed(1)},${PLOT_HEIGHT} Z`;
      from = null;
      return;
    }
    const y = PLOT_HEIGHT - ((value - min) / span) * PLOT_HEIGHT;
    if (from === null) {
      from = x;
      path += `M${x.toFixed(1)},${y.toFixed(1)}`;
    } else {
      path += `L${x.toFixed(1)},${y.toFixed(1)}`;
    }
    previous = x;
  });

  if (from !== null) path += `L${previous.toFixed(1)},${PLOT_HEIGHT} L${(from as number).toFixed(1)},${PLOT_HEIGHT} Z`;
  return path;
}

interface Tick {
  value: number;
  ratio: number;
  label: string;
}

/** 大きな数字。単位は添え字で小さく。 */
function Stat({ value, unit, note }: { value: string; unit: string; note: string }) {
  return (
    <div className="min-w-0 flex-1 border-t border-line pt-1.5">
      <p className="truncate text-[20px] font-bold leading-tight tabular-nums">
        {value}
        <span className="ml-1 text-[11px] font-medium text-muted">{unit}</span>
      </p>
      <p className="mt-0.5 text-[11px] text-muted">{note}</p>
    </div>
  );
}

/**
 * 横軸の文字。
 *
 * **1段ごとに置く。** 項目が7段あると縦に1000pxを超えるので、
 * まとめて1か所に置くと、見ているグラフと目盛りが同じ画面に入らない。
 * 何km地点の話かは、そのグラフを見ながら読めないと意味がない。
 */
function XAxis({ ticks, caption }: { ticks: Tick[]; caption: string }) {
  return (
    <>
      <div className="relative mt-1 h-2">
        {ticks.map((tick) => (
          <span
            key={tick.value}
            className="absolute top-0 block h-1.5 w-1.5 rounded-full bg-line"
            style={{ left: `${tick.ratio * 100}%`, transform: 'translateX(-50%)' }}
          />
        ))}
      </div>
      <div className="relative mt-0.5 h-4 text-[10px] text-muted tabular-nums">
        {ticks.map((tick) => {
          // 端の文字は、はみ出さないよう内側へ寄せる。
          const edge = tick.ratio < 0.06 ? 'left' : tick.ratio > 0.94 ? 'right' : 'center';
          return (
            <span
              key={tick.value}
              className="absolute top-0 whitespace-nowrap"
              style={
                edge === 'left'
                  ? { left: 0 }
                  : edge === 'right'
                    ? { right: 0 }
                    : { left: `${tick.ratio * 100}%`, transform: 'translateX(-50%)' }
              }
            >
              {tick.label}
            </span>
          );
        })}
      </div>
      <p className="mt-1.5 text-center text-[10px] text-muted">{caption}</p>
    </>
  );
}

function Chart({
  metric,
  xs,
  ticks,
  caption,
  at,
  onHover,
}: {
  metric: Metric;
  xs: number[];
  /** 横軸の目盛り。全部のグラフで同じ位置に立てる。 */
  ticks: Tick[];
  caption: string;
  at: number | null;
  onHover: (index: number | null) => void;
}) {
  const numbers = metric.values.filter((value): value is number => value !== null);
  if (numbers.length < 2) return null;

  const low = Math.min(...numbers);
  const high = Math.max(...numbers);
  const axis = axisFor(low, high, metric.ySteps);

  // **平均は、そのグラフの中の基準。** 「いつもより速い/遅い」はここからの距離で読む。
  const mean = metric.mean ?? numbers.reduce((sum, value) => sum + value, 0) / numbers.length;

  const show = metric.format ?? ((value: number) => `${Math.round(value)}`);
  // ペースだけ上下が逆。軸も平均線も、まとめて裏返してから置く。
  const flip = (value: number) => (metric.inverted ? axis.base + (axis.base + axis.span) - value : value);
  const plot = metric.values.map((value) => (value === null ? null : flip(value)));

  const path = pathOf(plot, xs, axis.base, axis.span);
  const area = areaOf(plot, xs, axis.base, axis.span);
  const meanY = PLOT_HEIGHT - ((flip(mean) - axis.base) / axis.span) * PLOT_HEIGHT;

  const current = at !== null ? metric.values[at] : null;
  const best = metric.inverted ? low : high;

  const pointY = (() => {
    if (at === null) return null;
    const value = plot[at];
    if (value === null || value === undefined) return null;
    return PLOT_HEIGHT - ((value - axis.base) / axis.span) * PLOT_HEIGHT;
  })();

  return (
    <section className="mt-5 border-t border-line pt-4 first:mt-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate text-[13px] font-semibold">{metric.label}</p>
        {current !== null && current !== undefined && (
          <p className="shrink-0 text-[13px] font-bold tabular-nums" style={{ color: metric.color }}>
            {show(current)}
            <span className="ml-0.5 text-[10px] font-medium text-muted">{metric.unit}</span>
          </p>
        )}
      </div>

      {/* 大きな数字を先に出す。グラフを読む前に、まず結論が分かるように。 */}
      <div className="mt-2 flex gap-3">
        <Stat value={show(mean)} unit={metric.unit} note="平均" />
        {metric.extra && (
          <Stat
            value={show(metric.extra === 'best' ? best : high)}
            unit={metric.unit}
            note={metric.extra === 'best' ? 'ベスト' : '最大'}
          />
        )}
        {!metric.extra && <div className="min-w-0 flex-1" />}
      </div>

      <div className="mt-3 flex gap-1.5">
        {/*
          縦軸の文字。**SVG の外に置く。**
          中に入れると、横幅に合わせて引き伸ばされた時に字まで歪む。
        */}
        <div className="relative w-9 shrink-0 text-[10px] text-muted tabular-nums" style={{ height: PLOT_HEIGHT }}>
          {axis.ticks.map((value) => (
            <span
              key={value}
              className="absolute right-0 whitespace-nowrap"
              style={{
                top: `${(1 - (value - axis.base) / axis.span) * 100}%`,
                transform: 'translateY(-50%)',
              }}
            >
              {show(metric.inverted ? flip(value) : value)}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <svg
            viewBox={`0 0 ${WIDTH} ${PLOT_HEIGHT}`}
            className="block w-full touch-none"
            style={{ height: PLOT_HEIGHT }}
            preserveAspectRatio="none"
            role="img"
            aria-label={`${metric.label}の推移。平均${show(mean)}${metric.unit}。${show(low)}から${show(high)}。`}
            onPointerDown={(event) => onHover(indexAt(event, xs))}
            onPointerMove={(event) => event.buttons !== 0 && onHover(indexAt(event, xs))}
            onPointerLeave={() => onHover(null)}
          >
            {/* 縦軸の目盛り線。数値の線より必ず薄く、細く。 */}
            {axis.ticks.map((value) => {
              const y = (1 - (value - axis.base) / axis.span) * PLOT_HEIGHT;
              return (
                <line
                  key={value}
                  x1={0}
                  x2={WIDTH}
                  y1={y}
                  y2={y}
                  stroke="var(--chart-grid)"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
              );
            })}
            {ticks.map((tick) => (
              <line
                key={tick.value}
                x1={tick.ratio * WIDTH}
                x2={tick.ratio * WIDTH}
                y1={0}
                y2={PLOT_HEIGHT}
                stroke="var(--chart-grid)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}

            <path d={area} fill={metric.color} opacity={0.3} />
            <path
              d={path}
              fill="none"
              stroke={metric.color}
              strokeWidth={2}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />

            {/*
              平均の線。**破線にする。**
              実測と同じ実線だと、どちらが走った結果なのか分からなくなる。
            */}
            <line
              x1={0}
              x2={WIDTH}
              y1={meanY}
              y2={meanY}
              stroke="var(--chart-mean)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
            />

            {at !== null && (
              <line
                x1={xs[at]}
                x2={xs[at]}
                y1={0}
                y2={PLOT_HEIGHT}
                stroke="var(--chart-mean)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {pointY !== null && (
              <circle
                cx={xs[at!]}
                cy={pointY}
                r={3.5}
                fill={metric.color}
                stroke="var(--bg-elevated)"
                strokeWidth={2}
              />
            )}
          </svg>

          <XAxis ticks={ticks} caption={caption} />
        </div>
      </div>
    </section>
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
  const [axis, setAxis] = useState<Axis>('time');
  const [at, setAt] = useState<number | null>(null);

  const hasDistance = series.km.some((value) => value > 0);
  const useDistance = axis === 'distance' && hasDistance;
  const source = useDistance ? series.km : series.t;

  // 横軸の値を、描く位置に直す。**時間で等間隔に描かない。**
  // 止まっていた時間があると、距離で見た形が歪む。
  const { xs, ticks } = useMemo(() => {
    const max = Math.max(...source, 0.001);
    const min = Math.min(...source, 0);
    const width = Math.max(max - min, 0.001);
    const place = (value: number) => ((value - min) / width) * WIDTH;
    const label = (value: number) =>
      useDistance ? `${value.toFixed(max - min >= 10 ? 1 : 2)}` : clock(value);
    const count = !useDistance && max >= 3600 ? X_TICKS_LONG : X_TICKS;

    return {
      xs: source.map(place),
      ticks: xTicksFor(min, max, count).map((value) => ({
        value,
        ratio: (value - min) / width,
        label: label(value),
      })),
    };
  }, [source, useDistance]);

  // 全体の平均ペース。点ごとのペースを平均したものとは別物なので、ここで出す。
  const runKm = (series.km[series.km.length - 1] ?? 0) - (series.km[0] ?? 0);
  const runSec = (series.t[series.t.length - 1] ?? 0) - (series.t[0] ?? 0);
  const overallPace = runKm > 0 && runSec > 0 ? runSec / runKm : undefined;

  const metrics: Metric[] = [
    {
      key: 'pace',
      label: 'ペース',
      unit: '/km',
      color: 'var(--chart-1)',
      values: series.pace ?? [],
      inverted: true,
      extra: 'best',
      // 走った時間 ÷ 走った距離。上のタイルの「平均ペース」と同じ出し方に揃える。
      mean: overallPace,
      // 秒の刻みは、10・15・30秒…と人が使っている単位で。
      ySteps: [10, 15, 30, 60, 120, 300, 600],
      format: (v) => formatPace(v).replace('/km', ''),
    },
    { key: 'hr', label: '心拍', unit: 'bpm', color: 'var(--chart-2)', values: series.hr, extra: 'max' },
    {
      key: 'cadence',
      label: 'ピッチ',
      unit: 'spm',
      color: 'var(--chart-3)',
      values: series.cadence ?? [],
      extra: 'max',
    },
    {
      key: 'power',
      label: 'パワー',
      unit: 'W',
      color: 'var(--chart-4)',
      values: series.power ?? [],
      extra: 'max',
    },
    {
      key: 'vo',
      label: '上下動',
      unit: 'cm',
      color: 'var(--chart-5)',
      values: series.vo ?? [],
      ySteps: [0.2, 0.5, 1, 2, 5],
      format: (v) => v.toFixed(1),
    },
    { key: 'gct', label: '接地時間', unit: 'ms', color: 'var(--chart-6)', values: series.gct ?? [] },
    // 歩幅はピッチと対になる。並べて見ると「回転で速いのか、伸びで速いのか」が分かる。
    { key: 'step', label: '歩幅', unit: 'cm', color: 'var(--chart-7)', values: series.step ?? [] },
  ];
  const shown = metrics.filter((metric) => metric.values.some((value) => value !== null));
  if (shown.length === 0) return null;

  const caption = useDistance ? '距離（km）' : '時間（時：分：秒）';

  return (
    <div className="mt-5">
      <p className="text-[13px] font-semibold">走っている間の推移</p>

      {/* 横軸の切り替え。時計の画面と同じ、横いっぱいの2つ割り。 */}
      <div className="mt-2 flex overflow-hidden rounded-[10px] bg-sunken p-0.5 text-[12px]">
        {(['time', 'distance'] as Axis[]).map((value) => (
          <button
            key={value}
            type="button"
            disabled={value === 'distance' && !hasDistance}
            onClick={() => {
              setAxis(value);
              setAt(null);
            }}
            className={`min-w-0 flex-1 rounded-[8px] py-1.5 font-medium disabled:opacity-30 ${
              (useDistance ? 'distance' : 'time') === value
                ? 'bg-accent text-[var(--accent-fg)]'
                : 'text-muted'
            }`}
          >
            {value === 'distance' ? '距離' : '時間'}
          </button>
        ))}
      </div>

      <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
        グラフを触ると、その地点の値が
        <strong className="font-semibold text-fg">すべての項目で</strong>揃って出ます。
        破線は平均です。
      </p>

      {/*
        **項目が1つしか無い時に、黙って1本だけ出さない。**
        取り込んだ時期によって持っている項目が違うので、
        「グラフが出ない」ではなく「入れ直せば増える」と分かる形にする。
      */}
      {shown.length === 1 && (
        <p className="mt-2 rounded-[12px] bg-sunken px-3 py-2 text-[11px] leading-relaxed text-muted">
          この練習は<strong className="font-semibold text-fg">{shown[0].label}しか持っていません。</strong>
          取り込んだ時期によって、残っている項目が違います。
          <strong className="font-semibold text-fg">同じファイルをもう一度取り込むと、ほかの項目も入ります。</strong>
          上下動・接地時間・歩幅・パワーは FIT ファイルにだけ入っています。
        </p>
      )}

      {shown.map((metric) => (
        <Chart
          key={metric.key}
          metric={metric}
          xs={xs}
          ticks={ticks}
          caption={caption}
          at={at}
          onHover={setAt}
        />
      ))}
    </div>
  );
}
