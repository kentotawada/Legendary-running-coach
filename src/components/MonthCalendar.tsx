'use client';

import { useMemo, useState } from 'react';
import {
  WEEKDAYS,
  buildMonth,
  intensityOf,
  monthRange,
  shiftMonth,
  type CalendarDay,
} from '@/lib/calendar';
import { CALORIES_NOTE } from '@/lib/calories';
import type { RunnerProfile } from '@/lib/types';

/**
 * ひと月を、1枚の表で見る。
 *
 * グラフは「どれだけ積んだか」を見せるが、**「どれだけ空いたか」は見せない。**
 * 枡を並べて初めて、空白が空白として目に入る。
 * 「平日は無理で、土日だけ走っている」のような自分の癖は、
 * 数字をいくら並べても分からず、ここで初めて見える。
 *
 * **責める画面にしない。** 空白を赤くしない、連続記録を切らさせない、
 * といった作りは、一度休んだ人をそのまま遠ざける。
 * 走った日を塗るだけにして、空白は空白のまま置いておく。
 */
export default function MonthCalendar({ profile }: { profile: RunnerProfile | null }) {
  const now = useMemo(() => new Date(), []);
  const range = useMemo(() => monthRange(profile, now), [profile, now]);
  const [at, setAt] = useState(range.last);
  const [picked, setPicked] = useState<CalendarDay | null>(null);

  const month = useMemo(
    () => buildMonth(profile, at.year, at.month, now),
    [profile, at.year, at.month, now],
  );

  const atFirst = at.year === range.first.year && at.month === range.first.month;
  const atLast = at.year === range.last.year && at.month === range.last.month;

  const move = (by: number) => {
    setPicked(null);
    setAt(shiftMonth(at.year, at.month, by));
  };

  return (
    <div>
      {/* 月を動かす。**記録より前と、今月より先へは行かせない。** */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => move(-1)}
          disabled={atFirst}
          aria-label="前の月"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-line disabled:opacity-25"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <p className="text-[15px] font-bold tabular-nums">{month.label}</p>
        <button
          type="button"
          onClick={() => move(1)}
          disabled={atLast}
          aria-label="次の月"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-line disabled:opacity-25"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((label) => (
          <span key={label} className="text-[10px] text-muted">
            {label}
          </span>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {month.weeks.flat().map((day) => {
          const strength = intensityOf(day, month.longestKm);
          const active = picked?.date === day.date;
          return (
            <button
              key={day.date}
              type="button"
              onClick={() => setPicked(active ? null : day)}
              aria-label={`${day.day}日${day.km > 0 ? ` ${day.km.toFixed(1)}km` : ' 記録なし'}`}
              aria-pressed={active}
              className={[
                'relative aspect-square rounded-[9px] text-[11px] tabular-nums transition',
                day.inMonth ? '' : 'opacity-25',
                active ? 'ring-2 ring-[color:var(--accent)]' : '',
                day.isToday && !active ? 'ring-1 ring-[color:var(--fg-muted)]' : '',
                strength === 0 ? 'bg-sunken' : '',
              ].join(' ')}
              style={
                strength > 0
                  ? {
                      // 走った日だけを塗る。濃さは、その月のいちばん長い日を基準にする。
                      background: `color-mix(in srgb, var(--accent) ${Math.round(strength * 100)}%, var(--bg-sunken))`,
                      color: strength > 0.55 ? 'var(--accent-fg)' : 'var(--fg)',
                    }
                  : undefined
              }
            >
              <span className="absolute left-1 top-0.5 font-medium">{day.day}</span>
              {/* 痛みがあった日。**空白の理由が見えることが大事。** */}
              {day.pain && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full"
                  style={{ background: 'var(--warn)' }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* 押した日の中身。**押すまで出さない。** 枡の中に書くと読めない大きさになる。 */}
      {picked && (
        <div className="mt-3 rounded-[14px] bg-sunken px-3.5 py-3">
          <p className="text-[13px] font-bold">
            {Number(picked.date.slice(5, 7))}月{picked.day}日
          </p>
          {picked.km > 0 || picked.minutes > 0 ? (
            <p className="mt-1 text-[13px] tabular-nums">
              {picked.km > 0 && <span>{picked.km.toFixed(1)} km</span>}
              {picked.minutes > 0 && <span className="ml-2">{Math.round(picked.minutes)} 分</span>}
              {picked.kcal !== null && (
                <span className="ml-2 text-muted">約 {picked.kcal.toLocaleString('ja-JP')} kcal</span>
              )}
            </p>
          ) : (
            <p className="mt-1 text-[13px] text-muted">
              {picked.isFuture ? 'まだ来ていない日です' : '記録はありません'}
            </p>
          )}
          {picked.pain && (
            <p className="mt-1 text-[12px] font-semibold text-warn">痛みを抱えていた日です</p>
          )}
          {picked.weightKg !== undefined && (
            <p className="mt-1 text-[12px] text-muted tabular-nums">
              体重 {picked.weightKg} kg
            </p>
          )}
        </div>
      )}

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Tile value={String(month.activeDays)} unit="日" label="動いた日" />
        <Tile value={month.km.toFixed(1)} unit="km" label="走った距離" />
        <Tile
          value={month.kcal === null ? '—' : month.kcal.toLocaleString('ja-JP')}
          unit={month.kcal === null ? undefined : 'kcal'}
          label="消費の目安"
        />
      </div>

      {month.kcal === null && month.km > 0 && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          体重を記録すると、消費カロリーの目安も出ます（スタンプの「体重をはかる」から）。
        </p>
      )}
      {month.kcal !== null && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted">{CALORIES_NOTE}</p>
      )}
    </div>
  );
}

function Tile({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <div className="rounded-[14px] border border-line py-2.5">
      <p className="text-[18px] font-bold tabular-nums">
        {value}
        {unit && <span className="ml-0.5 text-[11px] font-medium text-muted">{unit}</span>}
      </p>
      <p className="mt-0.5 text-[10px] text-muted">{label}</p>
    </div>
  );
}
