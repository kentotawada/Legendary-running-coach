'use client';

import { useMemo } from 'react';
import {
  HORIZON_WEEKS,
  OUTLOOK_NOTE,
  goalOutlook,
  paceOutlook,
  weightOutlook,
} from '@/lib/forecast';
import { formatPace, parseDuration, resolveTargetPace } from '@/lib/goals';
import type { RunnerProfile } from '@/lib/types';

/**
 * このまま続けたら、3か月後はどうなるか。
 *
 * **積み上げを見せるだけでは、足りない。** 過去のグラフは「やってきたこと」を
 * 見せるが、続ける理由にはなりにくい。「この調子なら目標に届く」が見えた時に、
 * 人は明日も走る。
 *
 * ただし、ここは**いちばん嘘をつきやすい場所**でもある。
 * 1つの数字で言い切らない。幅で出し、条件を必ず書く。
 */
export default function Outlook({ profile }: { profile: RunnerProfile | null }) {
  const now = useMemo(() => new Date(), []);
  const weight = useMemo(() => weightOutlook(profile, now), [profile, now]);
  const pace = useMemo(() => paceOutlook(profile, now), [profile, now]);
  const goal = useMemo(() => {
    // resolveTargetPace は "4:58/km" を返す。単位が付いたままでは読めない。
    const target = parseDuration(resolveTargetPace(profile?.goal)?.replace(/\s*\/\s*km$/i, ''));
    return goalOutlook(profile, pace, target);
  }, [profile, pace]);

  const anything = weight.ready || pace.ready;

  return (
    <div>
      <p className="mb-3 text-[12px] leading-relaxed text-muted">
        {HORIZON_WEEKS}週（約3か月）先の見込み。
      </p>

      {pace.ready ? (
        <Card
          label="練習のペース"
          now={formatPace(pace.now)}
          then={
            pace.direction === 'flat'
              ? 'いまと同じくらい'
              : `${formatPace(pace.fast).replace("/km", "")} 〜 ${formatPace(pace.slow)}`
          }
          tone={pace.direction === 'faster' ? 'good' : 'plain'}
          note={
            pace.direction === 'faster'
              ? `1kmあたり ${Math.round(pace.now - pace.fast)} 秒ほど速くなる見込み`
              : pace.direction === 'slower'
                ? 'いまは少しずつ遅くなっています。距離を落として、休む日を増やしてみてください'
                : undefined
          }
        />
      ) : (
        <Waiting label="練習のペース" reason={pace.reason} />
      )}

      {goal && (
        <p
          className={`mt-2 rounded-[12px] px-3.5 py-2.5 text-[13px] font-semibold leading-relaxed ${
            goal.reaching ? 'bg-good-soft text-good' : 'bg-sunken text-fg'
          }`}
        >
          {goal.summary}
        </p>
      )}

      <div className="mt-2.5">
        {weight.ready ? (
          <Card
            label="体重"
            now={`${weight.now} kg`}
            then={
              weight.direction === 'flat'
                ? 'いまと同じくらい'
                : `${weight.low} 〜 ${weight.high} kg`
            }
            tone="plain"
            note={
              weight.tooFast
                ? undefined
                : weight.direction === 'flat'
                  ? undefined
                  : `1週あたり ${Math.abs(weight.perWeek)} kg の変化が続いた場合`
            }
          />
        ) : (
          <Waiting label="体重" reason={weight.reason} />
        )}
      </div>

      {/*
        **速すぎる減り方は、夢として見せない。**
        走る人にとって週1%を超える減量は、筋肉も一緒に落ち、
        故障と貧血の入口になる。ここだけは、はっきり言う。
      */}
      {weight.ready && weight.tooFast && (
        <p className="mt-2 rounded-[12px] bg-warn-soft px-3.5 py-2.5 text-[12px] leading-relaxed text-warn">
          <strong className="font-semibold">いまの減り方は、走る人にとっては速すぎます。</strong>
          （1週あたり {Math.abs(weight.rawPerWeek)} kg）
          筋肉も一緒に落ちて、故障や貧血につながります。上の見込みは、
          安全な速さに置きなおした数字です。食べる量を減らしすぎていないか、
          コーチに話してみてください。
        </p>
      )}

      {anything && (
        <p className="mt-3 text-[11px] leading-relaxed text-muted">{OUTLOOK_NOTE}</p>
      )}
    </div>
  );
}

function Card({
  label,
  now,
  then,
  note,
  tone,
}: {
  label: string;
  now: string;
  then: string;
  note?: string;
  tone: 'good' | 'plain';
}) {
  return (
    <div className="rounded-[14px] border border-line px-3.5 py-3">
      <p className="text-[11px] text-muted">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-[14px] tabular-nums text-muted">{now}</span>
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
        <span
          className={`text-[17px] font-bold tabular-nums ${tone === 'good' ? 'text-good' : ''}`}
        >
          {then}
        </span>
      </div>
      {note && <p className="mt-1 text-[11px] leading-relaxed text-muted">{note}</p>}
    </div>
  );
}

/** **「—」だけを出さない。** 何をすれば出るのかを書く。 */
function Waiting({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="rounded-[14px] border border-dashed border-line px-3.5 py-3">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">{reason}</p>
    </div>
  );
}
