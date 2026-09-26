'use client';

import type { HeartRateZone } from '@/lib/zones';
import { timeInZones } from '@/lib/zones';

/**
 * 心拍ゾーンごとの時間。
 *
 * **推移のグラフでは答えられない問いに答える。**
 * 「この90分で、閾値の強度にどれだけ居たか」は、線を目で積分しても分からない。
 *
 * 並びは時計の画面と同じ。上が強いゾーン、下が楽なゾーン。
 * 1行につき: ゾーン番号 / 範囲・呼び名 / 棒 / 時間 / 割合。
 */

/**
 * ゾーンの色。
 *
 * **走る世界の決まりごとに合わせる。** 灰・青・緑・橙・赤の並びは、
 * どの時計でもどのアプリでも同じ意味で使われている。
 * ここだけ独自の配色にすると、時計の画面と見比べた人が必ず読み違える。
 *
 * 明るい画面で緑だけコントラストが 3:1 を少し下回るが、
 * どの行にも番号・範囲・時間・割合が文字で出ているので、色だけに頼っていない。
 */
const ZONE_COLOR = [
  'var(--zone-1)',
  'var(--zone-2)',
  'var(--zone-3)',
  'var(--zone-4)',
  'var(--zone-5)',
];

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = `${Math.round(seconds) % 60}`.padStart(2, '0');
  return m >= 60 ? `${Math.floor(m / 60)}:${`${m % 60}`.padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export default function ZoneBars({
  hrSeconds,
  zones,
  note,
}: {
  hrSeconds: [number, number][] | undefined;
  zones: HeartRateZone[];
  /** 何を基準に出したゾーンか。推定が混じっている時は、それも書く。 */
  note?: string;
}) {
  const rows = timeInZones(hrSeconds, zones);
  if (rows.length === 0) return null;

  // 強いゾーンを上に。時計の画面と同じ向きにする。
  const ordered = [...rows].reverse();

  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="text-[13px] font-semibold">心拍ゾーンの時間</p>

      <ul className="mt-2 space-y-2.5">
        {ordered.map((row) => {
          const index = rows.indexOf(row);
          return (
            <li key={row.zone.id}>
              <p className="text-[12px]">
                <strong className="font-semibold">ゾーン{index + 1}</strong>
                <span className="ml-2 text-[11px] text-muted">
                  {row.zone.range}bpm・{row.zone.name}
                </span>
              </p>
              <div className="mt-1 flex items-center gap-2">
                <span className="relative block h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-sunken">
                  <span
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{
                      width: `${Math.max(row.ratio * 100, row.seconds > 0 ? 2 : 0)}%`,
                      background: ZONE_COLOR[index],
                    }}
                  />
                </span>
                <span className="w-14 shrink-0 text-right text-[12px] font-semibold tabular-nums">
                  {clock(row.seconds)}
                </span>
                <span className="w-9 shrink-0 text-right text-[11px] text-muted tabular-nums">
                  {Math.round(row.ratio * 100)}%
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      {/*
        **どうやって出した数字かを書く。**
        ゾーンの境目は、最大心拍やLTHRの持ち方で変わる。
        時計の画面と数字が合わない時、原因がここにあると分かるようにしておく。
      */}
      {note && <p className="mt-2 text-[10px] leading-relaxed text-muted">{note}</p>}
    </div>
  );
}
