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
              className="rounded-[12px] bg-accent-soft px-3 py-2"
            >
              <p className="t-note font-bold text-accent">{best.label}</p>
              <p className="t-body font-bold leading-tight text-accent tabular-nums">
                {raceTime(best.race.result!.finishSec)}
              </p>
              <p className="t-note text-muted">{best.race.date.slice(0, 4)}年</p>
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
                className="flex w-full items-center gap-3 rounded-[14px] bg-sunken px-3.5 py-3 text-left active:scale-[0.99]"
              >
                {/*
                  メダル。**同じ形を並べることに意味がある。**
                  並んだ数そのものが、積み上げになる。
                */}
                <span
                  className={[
                    'flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-full border-2 t-note font-bold leading-none',
                    best
                      ? 'bg-accent text-[var(--accent-fg)]'
                      : 'bg-sunken text-muted',
                  ].join(' ')}
                >
                  <span>{km ? distanceLabel(km) : '完走'}</span>
                  {best && <span className="mt-0.5 t-note">自己ベスト</span>}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate t-body font-bold">{race.name}</span>
                  <span className="block t-note text-muted tabular-nums">
                    {race.date}
                    {race.result?.placing?.overall
                      ? ` ・ ${race.result.placing.overall.toLocaleString()}位`
                      : ''}
                  </span>
                </span>

                <span className="shrink-0 text-right">
                  <span className="block t-body font-bold leading-tight tabular-nums">
                    {raceTime(race.result!.finishSec)}
                  </span>
                  {fade && (
                    <span
                      className={`block t-note tabular-nums ${fade.negative ? 'text-accent' : 'text-muted'}`}
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
