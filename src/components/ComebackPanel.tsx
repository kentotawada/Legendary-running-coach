'use client';

import type { ComebackPlan } from '@/lib/comeback';
import { LADDER_RULES } from '@/lib/comeback';
import { findFigure } from '@/lib/figures';
import { FIGURE_VIEWBOX, figureArt } from './FigureArt';

/**
 * 走れない間の、その先。
 *
 * **止めるのは半分でしかない。**
 * 「今日は走りません」で終わると、止められた人は何をすればいいか分からないまま、
 * 結局こっそり走るか、アプリを閉じる。
 *
 * ここに出すのは3つだけ。代わりにやること・戻る順番・病院を考える目安。
 * **診断はしない。** 病名は出さないし、いつ戻れるとも言わない。
 */
export default function ComebackPanel({ plan }: { plan: ComebackPlan }) {
  return (
    <div className="mt-6 border-t border-line pt-4">
      <p className="text-[13px] font-bold">走れない間の、やること</p>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">{plan.note}</p>

      <ul className="mt-3 space-y-2">
        {plan.instead.map((item) => {
          const figure = item.figureId ? findFigure(item.figureId) : null;
          const art = item.figureId ? figureArt(item.figureId) : null;
          return (
            <li
              key={item.label}
              className="flex items-start gap-3 rounded-[12px] bg-sunken px-3 py-2.5"
            >
              {figure && art && (
                <svg
                  viewBox={FIGURE_VIEWBOX}
                  className="h-[52px] w-[52px] shrink-0 rounded-[8px] bg-bg"
                  aria-hidden="true"
                >
                  {art}
                </svg>
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold">{item.label}</span>
                {item.detail && (
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">
                    {item.detail}
                  </span>
                )}
                {figure && !item.detail && (
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">
                    {figure.dose}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {/*
        **日数で戻さない。** 「2週間で戻れます」は誰にも言えない。
        段ごとの条件だけを置く。
      */}
      <p className="mt-5 text-[13px] font-bold">走りに戻るまで</p>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">
        日数では決めません。
        <strong className="font-semibold text-fg">痛みが出なければ、次の段へ。</strong>
      </p>
      <ol className="mt-2 space-y-2">
        {plan.stages.map((stage) => (
          <li key={stage.step} className="flex gap-2.5">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold tabular-nums text-[var(--accent-fg)]">
              {stage.step}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold">{stage.title}</span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{stage.what}</span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-accent">
                → {stage.next}
              </span>
            </span>
          </li>
        ))}
      </ol>

      <ul className="mt-3 space-y-1">
        {LADDER_RULES.map((rule) => (
          <li key={rule} className="text-[12px] leading-relaxed text-muted">
            ・{rule}
          </li>
        ))}
      </ul>

      {/* ここは短くはっきり。**受診を遠ざけない。** */}
      <div className="mt-5 rounded-[14px] border border-[color:var(--warn)] bg-warn-soft px-3.5 py-3">
        <p className="text-[13px] font-bold text-warn">こうなったら、病院へ</p>
        <ul className="mt-1.5 space-y-1">
          {plan.seeDoctor.map((item) => (
            <li key={item} className="text-[12px] leading-relaxed">
              ・{item}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          ここは医療行為ではありません。迷ったら、みてもらうほうが早く戻れます。
        </p>
      </div>
    </div>
  );
}
