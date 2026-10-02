'use client';

import type { TodayPlan } from '@/lib/today';
import { INTENSITY_LABEL } from '@/lib/today';

/**
 * 開いた瞬間に目に入る、今日の一行。
 *
 * **ここが、このアプリを開く理由になる。**
 * 分析も履歴も、わざわざ開かないと出てこない。走る人が毎朝ほしいのは
 * 「で、今日は何をするのか」の一行で、それが画面の外にあるうちは、
 * すでに時計を持っている人がここを開く理由が無い。
 *
 * 帯にしているのは、**本文より上で、常に見えている**必要があるから。
 * 会話の中に置くと、送るたびに上へ流れて見えなくなる。
 */
export default function TodayBand({ plan, onOpen }: { plan: TodayPlan; onOpen: () => void }) {
  // 走らない日は色を変える。**休む日を、失敗のように見せない。**
  const resting = !plan.running;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="今日やることを開く"
      className={[
        'flex w-full items-center gap-3 border-b border-line px-4 py-2.5 text-left',
        resting ? 'bg-sunken' : 'bg-accent-soft',
      ].join(' ')}
    >
      <span
        className={[
          'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold',
          resting ? 'bg-bg text-muted' : 'bg-accent text-[var(--accent-fg)]',
        ].join(' ')}
      >
        {INTENSITY_LABEL[plan.intensity]}
      </span>

      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[14px] font-bold ${resting ? '' : 'text-accent'}`}>
          {plan.headline}
        </span>
        {/*
          **一行目だけで意味が通るようにする。** 補足は出るなら出す、で足りる。
          帯は2行までしか使わない。これ以上は本文を押し下げる。
        */}
        <span className="block truncate text-[11px] leading-snug text-muted">
          {plan.summary ?? plan.why}
        </span>
      </span>

      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 shrink-0 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
    </button>
  );
}
