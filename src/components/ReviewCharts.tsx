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
const PADDING_X = 6;

function Grid({ lines = 3 }: { lines?: number }) {
  return (
    <g>
      {Array.from({ length: lines }, (_, index) => {
        const y = (PLOT_HEIGHT / (lines - 1)) * index;
        return (
          <line
            key={index}
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
  const peak = bars.reduce((best, bar, index) => (bar.value > bars[best].value ? index : best), 0);
  const slot = (WIDTH - PADDING_X * 2) / bars.length;
  const barWidth = Math.max(8, slot - 2);
  const active = selected ?? bars.length - 1;

  return (
    <div>
      <p className="mb-1 flex items-baseline gap-1.5 text-[0.8em] text-muted">
        <span className="text-[1.25em] font-bold tabular-nums text-fg">{bars[active]?.value ?? 0}</span>
        <span>{unit}</span>
        <span>／ {bars[active]?.label}</span>
      </p>
      <svg
        viewBox={`0 0 ${WIDTH} ${PLOT_HEIGHT + AXIS_HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={ariaLabel}
      >
        <Grid />
        {bars.map((bar, index) => {
          const height = max > 0 ? (bar.value / max) * (PLOT_HEIGHT - 10) : 0;
          const x = PADDING_X + slot * index + (slot - barWidth) / 2;
          const y = PLOT_HEIGHT - height;
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
                x={PADDING_X + slot * index}
                y={0}
                width={slot}
                height={PLOT_HEIGHT + AXIS_HEIGHT}
                fill="transparent"
                onPointerDown={() => setSelected(index)}
              />
              {index === peak && bar.value > 0 && (
                <text
                  x={x + barWidth / 2}
                  y={Math.max(9, y - 4)}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--fg-muted)"
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
}: {
  points: LinePoint[];
  ariaLabel: string;
  invert?: boolean;
  /** 上下を反転させた時に、どちらが良い向きかを文字で言い切る。 */
  axisNote?: string;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  if (points.length < 2) return null;

  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const active = selected ?? points.length - 1;

  const x = (index: number) =>
    PADDING_X + (index / (points.length - 1)) * (WIDTH - PADDING_X * 2);
  const y = (value: number) => {
    const ratio = (value - min) / span;
    const fromTop = invert ? ratio : 1 - ratio;
    return 8 + fromTop * (PLOT_HEIGHT - 16);
  };

  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point.value)}`).join(' ');

  return (
    <div>
      <p className="mb-1 flex items-baseline gap-1.5 text-[0.8em] text-muted">
        <span className="text-[1.25em] font-bold text-fg">{points[active].display}</span>
        <span>／ {points[active].label}</span>
        {/* 反転した軸は誤読のもと。グラフの中ではなく、外に言い切って置く。 */}
        {axisNote && <span className="ml-auto text-[0.92em]">{axisNote}</span>}
      </p>
      <svg
        viewBox={`0 0 ${WIDTH} ${PLOT_HEIGHT + AXIS_HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={ariaLabel}
      >
        <Grid lines={2} />
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
                x={x(index) - (WIDTH - PADDING_X * 2) / (points.length - 1) / 2}
                y={0}
                width={(WIDTH - PADDING_X * 2) / (points.length - 1)}
                height={PLOT_HEIGHT + AXIS_HEIGHT}
                fill="transparent"
                onPointerDown={() => setSelected(index)}
              />
            </g>
          );
        })}
        <text x={PADDING_X} y={PLOT_HEIGHT + 14} fontSize={10} fill="var(--fg-muted)">
          {points[0].label}
        </text>
        <text x={WIDTH - PADDING_X} y={PLOT_HEIGHT + 14} textAnchor="end" fontSize={10} fill="var(--fg-muted)">
          {points[points.length - 1].label}
        </text>
      </svg>
    </div>
  );
}
