'use client';

import type { FitnessRead } from '@/lib/fitness';

/**
 * 目標に届くのか。
 *
 * **走る人が本当に知りたいのは、これひとつ。**
 * 時計も予測タイムを出すが、なぜその数字なのかも、何をすれば縮まるのかも言わない。
 * ここでは、**どの記録から出したか**を必ず見せて、次にやることまで出す。
 */

const TONE: Record<FitnessRead['verdict'], string> = {
  reachable: 'bg-accent-soft',
  close: 'bg-accent-soft',
  stretch: 'bg-sunken',
  far: 'bg-sunken',
  unknown: 'bg-sunken',
};

export default function FitnessCard({ read }: { read: FitnessRead }) {
  const bright = read.verdict === 'reachable' || read.verdict === 'close';

  return (
    <div className={`rounded-[16px] border px-4 py-3.5 ${TONE[read.verdict]}`}>
      <p className={`t-body font-bold leading-snug ${bright ? 'text-accent' : ''}`}>
        {read.headline}
      </p>
      <p className="mt-1.5 t-note leading-relaxed text-muted">{read.detail}</p>

      {read.predicted && read.target && (
        <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 t-note tabular-nums">
          <span>
            <span className="text-muted">いまの力 </span>
            <strong className="font-bold">{read.predicted}</strong>
          </span>
          <span>
            <span className="text-muted">目標 </span>
            <strong className="font-bold">{read.target}</strong>
          </span>
        </div>
      )}

      {read.next.length > 0 && (
        <>
          <p className="mt-3 t-note font-bold">縮めるには</p>
          <ul className="mt-1 space-y-1">
            {read.next.map((item) => (
              <li key={item} className="t-note leading-relaxed text-muted">
                ・{item}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
