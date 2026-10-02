'use client';

import type { WeekDay, WeekPlan } from '@/lib/week';

/**
 * この先7日の並び。
 *
 * **今日だけでは、計画の置き場所にならない。**
 * 「今週どうなるのか」が見えないと、結局それを置いている道具が本体になり、
 * こちらは相談しに来るだけの場所に戻る。
 *
 * 7つを横に並べるので、**1マスに入るのは2語まで。**
 * 詳しいことは、押した先（今日やること）と会話にある。
 */

const TONE: Record<WeekDay['kind'], string> = {
  rest: 'bg-sunken text-muted',
  easy: 'bg-accent-soft text-accent',
  point: 'bg-accent text-[var(--accent-fg)]',
  long: 'bg-accent text-[var(--accent-fg)]',
  race: 'bg-warn-soft text-warn',
};

export default function WeekStrip({ plan }: { plan: WeekPlan }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[13px] font-bold">この先7日</p>
        <p className="text-[11px] text-muted tabular-nums">
          合計 {plan.totalKm}km
          {plan.baseKm > 0 && <span className="ml-1">/ 土台 週{plan.baseKm}km</span>}
        </p>
      </div>

      <ul className="mt-2 flex gap-1">
        {plan.days.map((day) => (
          <li key={day.date} className="min-w-0 flex-1">
            <div
              className={[
                'flex h-[72px] flex-col items-center justify-center rounded-[10px] px-0.5 text-center',
                TONE[day.kind],
                day.isToday ? 'ring-2 ring-[color:var(--fg)] ring-offset-1 ring-offset-[color:var(--bg)]' : '',
              ].join(' ')}
            >
              <span className="text-[10px] opacity-80">{day.weekday}</span>
              <span className="mt-0.5 truncate text-[10px] font-bold leading-tight">{day.label}</span>
              {day.km !== undefined && (
                <span className="mt-0.5 text-[11px] font-bold tabular-nums">{day.km}</span>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/*
        **理由を必ず添える。** 並びだけ出すと、どこから来た数字なのかが分からず、
        「アプリが勝手に決めたノルマ」になる。
      */}
      <p className="mt-2 text-[11px] leading-relaxed text-muted">{plan.note}</p>
    </div>
  );
}
