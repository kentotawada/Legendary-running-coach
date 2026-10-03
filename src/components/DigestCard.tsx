'use client';

import type { WeeklyDigest } from '@/lib/digest';

/**
 * この7日の、ふりかえり。
 *
 * **「よく頑張りました」を言わない。** 数字を見せれば、本人が判断できる。
 * 頑張りの評価を外から渡すと、少ない週にこの画面を開けなくなる。
 */
export default function DigestCard({ digest }: { digest: WeeklyDigest }) {
  return (
    <div className="rounded-[16px] bg-sunken px-4 py-3.5">
      <p className="t-body font-bold leading-snug">{digest.headline}</p>
      <p className="mt-1.5 t-note leading-relaxed text-muted">{digest.detail}</p>

      {digest.longest && (
        <p className="mt-2.5 t-note tabular-nums">
          <span className="text-muted">いちばん長い1本 </span>
          <strong className="font-bold">{digest.longest.km}km</strong>
          {digest.longest.pace && <span className="ml-1 text-muted">{digest.longest.pace}</span>}
          {digest.longest.label && <span className="ml-1 text-muted">／{digest.longest.label}</span>}
        </p>
      )}

      {/* 痛みは、量の話より先に目に入る場所に置く。 */}
      {digest.pains.length > 0 && (
        <p className="mt-2 rounded-[10px] bg-warn-soft px-3 py-2 t-note leading-relaxed text-warn">
          この7日に {digest.pains.join('・')} が出ています。痛みがあるうちは、走って良くなることはありません。
        </p>
      )}
    </div>
  );
}
