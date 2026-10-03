'use client';

import { useState } from 'react';

/**
 * 積み上げを見せるためのグラフ。
 *
 * 作りの方針:
 *  - **1本のグラフに軸は1つ。** 2つの尺度を重ねると、無い相関が見えてしまう。
 *  - 線と棒は細く、目盛りは面から一段だけ浮かせる。太い塗りは画面を騒がしくする。
 *  - 値は必ずグラフの外（下の数字の行）からも読める。
 *    触らないと読めない値は、読めない値と同じ。
 *  - 数字を全部の点に添えない。いちばん大きいところと、いちばん新しいところだけ。
 */

const PLOT_HEIGHT = 108;
/** 目盛りの文字を置く帯。ここを別に取らないと、軸のラベルが枠からはみ出す。 */
const AXIS_HEIGHT = 20;
const WIDTH = 320;
/** 左に、縦の目盛りの数字を置く幅。 */
const AXIS_WIDTH = 30;
const PADDING_X = 6;
/** 絵を描く範囲の左端。 */
const PLOT_LEFT = AXIS_WIDTH + PADDING_X;
/** 絵を描く範囲の上端。目盛りの文字の高さぶん空ける。 */
const PLOT_TOP = 8;

/**
 * きりのいい目盛りを作る。
 *
 * **横線だけ引いても、目盛りが無ければ読めない。**
 * 「だいたいこのくらい」は分かっても、それが80kmなのか120kmなのかが
 * 分からないグラフは、形を眺めているだけになる。
 *
 * 1 / 2 / 5 の刻みから選ぶ。3や7の刻みは、人が頭の中で割れない。
 */
export function niceTicks(max: number, count = 5): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const rough = max / (count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= rough)! * magnitude;
  // **いちばん上の目盛りは、必ず最大値以上にする。** 下回ると、棒が目盛りを突き抜ける。
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + step / 2; value += step) {
    ticks.push(Math.round(value * 1000) / 1000);
  }
  return ticks.length >= 2 ? ticks : [0, step];
}

/** 目盛りの数字を短く。1000 を超えたら k にする。 */
function tickLabel(value: number): string {
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 1000)}k`;
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 10) / 10);
}

/**
 * 横線と、その値。
 *
 * **線は面から一段だけ浮かせる。** 濃い格子は、データより格子のほうが
 * 目に入る。数字は左にまとめて、絵の邪魔をしない。
 */
function Grid({
  ticks,
  toY,
  format = tickLabel,
}: {
  ticks: number[];
  toY: (value: number) => number;
  format?: (value: number) => string;
}) {
  return (
    <g>
      {ticks.map((tick) => {
        const y = toY(tick);
        return (
          <g key={tick}>
            <line
              x1={PLOT_LEFT}
              x2={WIDTH}
              y1={y}
              y2={y}
              stroke="var(--chart-grid)"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <text
              x={AXIS_WIDTH - 2}
              y={y + 3.5}
              textAnchor="end"
              fontSize={9.5}
              fill="var(--fg-muted)"
            >
              {format(tick)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export interface Bar {
  label: string;
  value: number;
  /** 読み取り用の一言。触った時に出す。 */
  detail?: string;
}

/**
 * 棒グラフ。棒の間は2pxだけ空け、線で区切らない。
 * 触った棒の値を上に出すが、同じ値は下の数字の行にも出している。
 */
export function BarChart({
  bars,
  unit,
  ariaLabel,
}: {
  bars: Bar[];
  unit: string;
  ariaLabel: string;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const max = Math.max(...bars.map((bar) => bar.value), 1);
  // 目盛りのいちばん上まで伸ばす。そうしないと、横線と棒の高さが対応しない。
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]!;
  const slot = (WIDTH - PLOT_LEFT - PADDING_X) / bars.length;
  const barWidth = Math.max(8, slot - 2);
  const active = selected ?? bars.length - 1;
  /*
    **いちばん上の目盛りの文字が、枠の外に出ないようにする。**
    0 から描くと、上端の数字の上半分が切れて読めない。
  */
  const toY = (value: number) => PLOT_TOP + (1 - value / top) * (PLOT_HEIGHT - PLOT_TOP);

  return (
    <div>
      <p className="mb-1 flex items-baseline gap-1.5 t-note text-muted">
        <span className="t-title font-bold tabular-nums text-fg">{bars[active]?.value ?? 0}</span>
        <span>{unit}</span>
        <span>／ {bars[active]?.label}</span>
      </p>
      <svg
        viewBox={`0 0 ${WIDTH} ${PLOT_HEIGHT + AXIS_HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={ariaLabel}
      >
        <Grid ticks={ticks} toY={toY} />
        {bars.map((bar, index) => {
          const y = toY(bar.value);
          const height = Math.max(0, PLOT_HEIGHT - y);
          const x = PLOT_LEFT + slot * index + (slot - barWidth) / 2;
          const isActive = index === active;
          return (
            <g key={bar.label}>
              {height > 0 && (
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={height}
                  rx={4}
                  fill="var(--chart-ink)"
                  opacity={isActive ? 1 : 0.55}
                />
              )}
              {/* 触るところは棒より広く取る。細い棒を狙わせない。 */}
              <rect
                x={PLOT_LEFT + slot * index}
                y={0}
                width={slot}
                height={PLOT_HEIGHT + AXIS_HEIGHT}
                fill="transparent"
                onPointerDown={() => setSelected(index)}
              />
              {/*
                数字は、触っている棒にだけ添える。
                **全部の点に数字を書かない。** 目盛りがあれば、だいたいは読める。
              */}
              {isActive && bar.value > 0 && (
                <text
                  x={x + barWidth / 2}
                  y={Math.max(9, y - 4)}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={600}
                  fill="var(--fg)"
                >
                  {bar.value}
                </text>
              )}
              <text
                x={x + barWidth / 2}
                y={PLOT_HEIGHT + 14}
                textAnchor="middle"
                fontSize={10}
                fill="var(--fg-muted)"
              >
                {bar.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export interface LinePoint {
  label: string;
  value: number;
  /** 画面に出す形。秒/km のような、そのままでは読めない値のため。 */
  display: string;
}

/**
 * 折れ線。
 *
 * ペースのように**小さいほど良い**値は、上下を反転させて「上ほど速い」にする。
 * そのままだと、速くなったのに線が下がって見える。
 * ただし反転は誤読のもとなので、軸の端に「速い / 遅い」と書いて逃げ道を塞ぐ。
 */
export function LineChart({
  points,
  ariaLabel,
  invert = false,
  axisNote,
  formatTick,
}: {
  points: LinePoint[];
  ariaLabel: string;
  invert?: boolean;
  /** 上下を反転させた時に、どちらが良い向きかを文字で言い切る。 */
  axisNote?: string;
  /** 縦の目盛りの書き方。秒/km のような、そのままでは読めない値のため。 */
  formatTick?: (value: number) => string;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  if (points.length < 2) return null;

  const values = points.map((point) => point.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  /*
    **0 から描かない。** 体重もペースも、0 からの棒には意味が無く、
    0 を含めると変化が線のゆらぎに潰れる。実際の幅に、少しだけ余白を足す。
  */
  const pad = (rawMax - rawMin || Math.abs(rawMax) * 0.02 || 1) * 0.15;
  const min = rawMin - pad;
  const max = rawMax + pad;
  const span = max - min || 1;
  const active = selected ?? points.length - 1;

  const x = (index: number) =>
    PLOT_LEFT + (index / (points.length - 1)) * (WIDTH - PLOT_LEFT - PADDING_X);
  const y = (value: number) => {
    const ratio = (value - min) / span;
    const fromTop = invert ? ratio : 1 - ratio;
    return 8 + fromTop * (PLOT_HEIGHT - 16);
  };

  /*
    目盛りは、実際にあった値の範囲から等間隔に取る。
    きりのいい数に丸めると、体重の 61.3〜62.1kg のような狭い幅では
    目盛りが1本も入らなくなる。
  */
  const lineTicks = [0, 0.5, 1].map((ratio) => rawMin + (rawMax - rawMin) * ratio);

  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point.value)}`).join(' ');

  return (
    <div>
      <p className="mb-1 flex items-baseline gap-1.5 t-note text-muted">
        <span className="t-title font-bold text-fg">{points[active].display}</span>
        <span>／ {points[active].label}</span>
        {/* 反転した軸は誤読のもと。グラフの中ではなく、外に言い切って置く。 */}
        {axisNote && <span className="ml-auto t-body">{axisNote}</span>}
      </p>
      <svg
        viewBox={`0 0 ${WIDTH} ${PLOT_HEIGHT + AXIS_HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={ariaLabel}
      >
        <Grid ticks={lineTicks} toY={y} format={formatTick ?? ((value) => tickLabel(value))} />
        <path d={path} fill="none" stroke="var(--chart-ink)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point, index) => {
          const isActive = index === active;
          return (
            <g key={`${point.label}-${index}`}>
              {isActive && (
                <circle
                  cx={x(index)}
                  cy={y(point.value)}
                  r={4.5}
                  fill="var(--chart-ink)"
                  stroke="var(--bg)"
                  strokeWidth={2}
                />
              )}
              <rect
                x={x(index) - (WIDTH - PLOT_LEFT - PADDING_X) / (points.length - 1) / 2}
                y={0}
                width={(WIDTH - PLOT_LEFT - PADDING_X) / (points.length - 1)}
                height={PLOT_HEIGHT + AXIS_HEIGHT}
                fill="transparent"
                onPointerDown={() => setSelected(index)}
              />
            </g>
          );
        })}
        <text x={PLOT_LEFT} y={PLOT_HEIGHT + 14} fontSize={10} fill="var(--fg-muted)">
          {points[0].label}
        </text>
        <text x={WIDTH - PADDING_X} y={PLOT_HEIGHT + 14} textAnchor="end" fontSize={10} fill="var(--fg-muted)">
          {points[points.length - 1].label}
        </text>
      </svg>
    </div>
  );
}
