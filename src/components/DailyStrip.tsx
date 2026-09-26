'use client';

import type { DailyStatus } from '@/lib/daily';
import StampIcon from './StampIcon';

/**
 * 毎日ここを開く理由になる帯。
 * 走れなかった日も、開いた・はかっただけでスタンプが付く。
 */
export default function DailyStrip({ daily, onOpen }: { daily: DailyStatus; onOpen: () => void }) {
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
        {daily.streakDays > 0 ? (
          <span className="font-bold text-accent">{daily.streakDays}日連続</span>
        ) : (
          <span className="font-bold">今日のスタンプ</span>
        )}
        <span className="block text-muted">
          {daily.earned === daily.stamps.length
            ? '今日は全部そろいました'
            : `あと${daily.stamps.length - daily.earned}つ`}
        </span>
      </span>

      <span aria-hidden="true" className="text-[13px] text-muted">
        ›
      </span>
    </button>
  );
}
