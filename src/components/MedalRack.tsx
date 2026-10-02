'use client';

import type { RaceEntry, RunnerProfile } from '@/lib/types';
import { raceDistanceKm } from '@/lib/gear-spec';
import {
  distanceLabel,
  fadeOf,
  finishedRaces,
  isPersonalBest,
  personalBests,
  raceTime,
} from '@/lib/race-result';

/**
 * 走った大会を、1本ずつ並べる。
 *
 * **練習の積み上げと、大会は、性質がまるで違う。**
 * 練習は量と流れで見るもので、1本の良し悪しはあまり意味を持たない。
 * 大会は逆で、**1本ずつが作品**。10年前の1本を、今でも見返す。
 *
 * 月ごとの棒グラフに混ぜてしまうと、その1本が棒の一部になって消える。
 * だから分けて、1本ずつ並べる。
 */
export default function MedalRack({
  profile,
  now,
  onOpen,
}: {
  profile: RunnerProfile | null;
  now: Date;
  onOpen: (race: RaceEntry) => void;
}) {
  const races = finishedRaces(profile);
  if (races.length === 0) return null;

  const bests = personalBests(profile);

  return (
    <div>
      {/*
        距離ごとの自己ベスト。**いちばん上に置く。**
        「で、自分はいま何分で走れるのか」が、開いて最初に知りたいこと。
      */}
      {bests.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {bests.map((best) => (
            <div
              key={best.distanceKm}
              className="rounded-[12px] border border-[color:var(--accent)] bg-accent-soft px-3 py-2"
            >
              <p className="text-[10px] font-bold text-accent">{best.label}</p>
              <p className="text-[15px] font-bold leading-tight text-accent tabular-nums">
                {raceTime(best.race.result!.finishSec)}
              </p>
              <p className="text-[10px] text-muted">{best.race.date.slice(0, 4)}年</p>
            </div>
          ))}
        </div>
      )}

      <ul className="space-y-2">
        {races.map((race) => {
          const km = raceDistanceKm(race);
          const fade = fadeOf(race.result!, km);
          const best = isPersonalBest(race, profile, now);

          return (
            <li key={race.id}>
              <button
                type="button"
                onClick={() => onOpen(race)}
                className="flex w-full items-center gap-3 rounded-[14px] border border-line bg-sunken px-3.5 py-3 text-left active:scale-[0.99]"
              >
                {/*
                  メダル。**同じ形を並べることに意味がある。**
                  並んだ数そのものが、積み上げになる。
                */}
                <span
                  className={[
                    'flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-full border-2 text-[10px] font-bold leading-none',
                    best
                      ? 'border-[color:var(--accent)] bg-accent text-[var(--accent-fg)]'
                      : 'border-line bg-bg text-muted',
                  ].join(' ')}
                >
                  <span>{km ? distanceLabel(km) : '完走'}</span>
                  {best && <span className="mt-0.5 text-[8px]">自己ベスト</span>}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-bold">{race.name}</span>
                  <span className="block text-[11px] text-muted tabular-nums">
                    {race.date}
                    {race.result?.placing?.overall
                      ? ` ・ ${race.result.placing.overall.toLocaleString()}位`
                      : ''}
                  </span>
                </span>

                <span className="shrink-0 text-right">
                  <span className="block text-[16px] font-bold leading-tight tabular-nums">
                    {raceTime(race.result!.finishSec)}
                  </span>
                  {fade && (
                    <span
                      className={`block text-[10px] tabular-nums ${fade.negative ? 'text-accent' : 'text-muted'}`}
                    >
                      後半 {fade.percent > 0 ? '+' : ''}
                      {fade.percent}%
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
