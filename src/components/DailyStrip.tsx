'use client';

import type { DailyStatus } from '@/lib/daily';
import StampIcon from './StampIcon';

/**
 * 毎日ここを開く理由になる帯。
 * 走れなかった日も、開いた・はかっただけでスタンプが付く。
 */
export default function DailyStrip({ daily, onOpen }: { daily: DailyStatus; onOpen: () => void }) {
  /**
   * 残りを、数ではなく**名前で**言う。
   * 「あと1つ」では、何をすれば1つ埋まるのかが分からない。
   * 1つなら名前を出す。2つ以上は、並べると帯に入らないので数で言う。
   */
  const left = daily.stamps.filter((stamp) => !stamp.done);
  const remaining =
    left.length === 0
      ? '今日は全部そろいました'
      : left.length === 1
        ? `あと1つ・${left[0].label}`
        : `あと${left.length}つ`;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 border-b border-line bg-elevated px-4 py-2 text-left"
      aria-label="今日のスタンプを開く"
    >
      <span className="flex gap-1.5">
        {daily.stamps.map((stamp) => (
          <span
            key={stamp.id}
            title={stamp.label}
            className={[
              'flex h-7 w-7 items-center justify-center rounded-full border transition',
              stamp.done
                ? 'border-[color:var(--accent)] bg-accent-soft text-accent'
                : 'border-line bg-sunken text-muted opacity-50',
            ].join(' ')}
          >
            <StampIcon id={stamp.id} size={17} />
          </span>
        ))}
      </span>

      <span className="min-w-0 flex-1 text-[12px] leading-tight">
        {/*
          **1日目を「1日連続」と言わない。** まだ何も続いていないのに
          続いていることにすると、この数字そのものが信用されなくなる。
        */}
        {daily.streakDays >= 2 ? (
          <span className="font-bold text-accent">{daily.streakDays}日連続</span>
        ) : (
          <span className="font-bold">今日のスタンプ</span>
        )}
        <span className="block truncate text-muted">{remaining}</span>
      </span>

      <span aria-hidden="true" className="text-[13px] text-muted">
        ›
      </span>
    </button>
  );
}
