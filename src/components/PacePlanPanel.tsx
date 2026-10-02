'use client';

import type { PacePlan } from '@/lib/pacing';

/**
 * 当日の通過タイム。
 *
 * **「前半を抑えて」は助言ではない。** 抑えるのは誰でも分かっている。
 * 分からないのは「最初の5kmを何分何秒で入るのか」。そこを出す。
 *
 * 表を長く並べない。**走りながら見るものではない**ので、
 * 必要なのは折り返しと、崩れた時の決めごと。
 */
export default function PacePlanPanel({ plan }: { plan: PacePlan }) {
  return (
    <div className="mt-6 border-t border-line pt-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[13px] font-bold">{plan.race.name}のペース配分</p>
        <p className="text-[11px] text-muted tabular-nums">
          {plan.distanceKm}km / 目標 {plan.targetTime}
        </p>
      </div>

      {/*
        暑い日の見込み。**本人の目標は書き換えない。**
        下げるかどうかを決めるのは本人で、こちらは材料を置くだけ。
      */}
      {plan.heat && (
        <div className="mt-2 rounded-[12px] bg-warn-soft px-3 py-2.5">
          <p className="text-[12px] font-bold text-warn">{plan.heat.headline}</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
            この気温なら <strong className="font-bold text-fg">{plan.heat.adjustedTime}</strong>（
            {plan.heat.adjustedPace}）が、目標と同じきつさになる見込みです。
            目標そのものは変えていません。決めるのはあなたです。
          </p>
        </div>
      )}

      <ul className="mt-3 space-y-1">
        {plan.splits.map((split) => (
          <li
            key={split.km}
            className="flex items-center gap-2 border-b border-line/60 pb-1 text-[12px] tabular-nums last:border-b-0"
          >
            <span className="w-14 shrink-0 font-semibold">{split.km}km</span>
            <span
              className={[
                'w-10 shrink-0 rounded-full px-1.5 py-0.5 text-center text-[10px] font-bold',
                split.phase === '入り'
                  ? 'bg-accent-soft text-accent'
                  : split.phase === '終盤'
                    ? 'bg-accent text-[var(--accent-fg)]'
                    : 'bg-sunken text-muted',
              ].join(' ')}
            >
              {split.phase}
            </span>
            <span className="min-w-0 flex-1 text-muted">{split.pace}</span>
            <span className="shrink-0 text-[14px] font-bold">{split.elapsed}</span>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[11px] leading-relaxed text-muted">{plan.note}</p>

      {/* **崩れてから考えると、たいてい歩く。** 先に決めておく。 */}
      <p className="mt-5 text-[13px] font-bold">崩れたときに、どうするか</p>
      <ul className="mt-2 space-y-1.5">
        {plan.ifItBreaks.map((item) => (
          <li key={item.when} className="rounded-[12px] bg-sunken px-3 py-2 text-[12px] leading-relaxed">
            <strong className="font-semibold">{item.when}</strong>
            <span className="mt-0.5 block text-muted">{item.what}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
