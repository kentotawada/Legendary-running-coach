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

export default function WeekStrip({
  plan,
  onPick,
  selected,
  hint,
}: {
  plan: WeekPlan;
  /** 押した日。渡さなければ、ただ見るだけの並びになる。 */
  onPick?: (day: WeekDay) => void;
  /** いま選んでいる日。 */
  selected?: string | null;
  /** 並びの上に出す一言（「移す先を選んでください」など）。 */
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="t-note font-bold">この先7日</p>
        <p className="t-note text-muted tabular-nums">
          合計 {plan.totalKm}km
          {plan.baseKm > 0 && <span className="ml-1">/ 土台 週{plan.baseKm}km</span>}
        </p>
      </div>

      {hint && <p className="mt-1.5 t-note font-semibold text-accent">{hint}</p>}

      <ul className="mt-2 flex gap-1">
        {plan.days.map((day) => {
          const body = (
            <>
              <span className="t-note opacity-80">{day.weekday}</span>
              <span className="mt-0.5 truncate t-note font-bold leading-tight">{day.label}</span>
              {day.km !== undefined && (
                <span className="mt-0.5 t-note font-bold tabular-nums">{day.km}</span>
              )}
              {/* 話して決めた日は、自動で置いた日と見分けが付くようにする。 */}
              {day.fromPlan && <span className="mt-0.5 t-note leading-none opacity-70">決めた</span>}
            </>
          );
          const shape = [
            'flex h-[72px] w-full flex-col items-center justify-center rounded-[10px] px-0.5 text-center',
            TONE[day.kind],
            day.isToday ? 'ring-2 ring-[color:var(--fg)]' : '',
            selected === day.date ? 'ring-2 ring-[color:var(--accent)]' : '',
            day.isToday || selected === day.date
              ? 'ring-offset-1 ring-offset-[color:var(--bg)]'
              : '',
          ].join(' ');

          return (
            <li key={day.date} className="min-w-0 flex-1">
              {onPick ? (
                <button
                  type="button"
                  onClick={() => onPick(day)}
                  aria-label={`${day.weekday}曜日 ${day.label}`}
                  className={`${shape} transition active:scale-[0.97]`}
                >
                  {body}
                </button>
              ) : (
                <div className={shape}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>

      {/*
        **理由を必ず添える。** 並びだけ出すと、どこから来た数字なのかが分からず、
        「アプリが勝手に決めたノルマ」になる。
      */}
      <p className="mt-2 t-note leading-relaxed text-muted">{plan.note}</p>
    </div>
  );
}
