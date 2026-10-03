'use client';

import { CONDITIONS, type ConditionId } from '@/lib/today';

/**
 * 今朝の体の感じを、押すだけで。
 *
 * **これが、時計に絶対できないこと。**
 * 心拍変動をいくら測っても、昨日の残業も、子どもの夜泣きも、出張の移動も分からない。
 * ここまで今日の予定は記録からしか決めていなかったので、寝不足の日も同じものが出ていた。
 *
 * 聞くのは**1つだけ。** 朝に3つも4つも押させたら、誰も押さなくなる。
 * そして**押した瞬間に、上の帯が変わる。** 変わらなければ、ただのアンケートになる。
 */
export default function ConditionRow({
  picked,
  onPick,
}: {
  /** すでに押してあれば、その段階。 */
  picked?: ConditionId | null;
  onPick: (condition: ConditionId) => void;
}) {
  return (
    <div className="flex items-center gap-2 border-t border-line px-4 py-2">
      <span className="shrink-0 t-note text-muted">今日の体は？</span>
      <div className="flex min-w-0 flex-1 justify-end gap-1.5">
        {CONDITIONS.map((condition) => {
          const active = picked === condition.id;
          return (
            <button
              key={condition.id}
              type="button"
              onClick={() => onPick(condition.id)}
              aria-pressed={active}
              className={[
                /*
                  枠線で囲わず、薄い面で置く。
                  **押してあるものだけが濃い。** 押す前の3つが縁取られていると、
                  どれか1つが選ばれているように見えて、押す必要が無いと思われる。
                */
                'rounded-full px-3 py-1 t-note font-semibold active:scale-[0.97]',
                active ? 'bg-accent text-[var(--accent-fg)]' : 'bg-sunken',
              ].join(' ')}
            >
              {condition.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
