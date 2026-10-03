'use client';

import type { TodayPlan } from '@/lib/today';
import { INTENSITY_LABEL } from '@/lib/today';

/**
 * 開いた瞬間に目に入る、今日の一行。
 *
 * **ここが、このアプリを開く理由になる。**
 * 分析も履歴も、わざわざ開かないと出てこない。走る人が毎朝ほしいのは
 * 「で、今日は何をするのか」の一行で、それが画面の外にあるうちは、
 * すでに時計を持っている人がここを開く理由が無い。
 *
 * 帯にしているのは、**本文より上で、常に見えている**必要があるから。
 * 会話の中に置くと、送るたびに上へ流れて見えなくなる。
 */
export default function TodayBand({
  plan,
  onOpen,
  onLog,
}: {
  plan: TodayPlan;
  onOpen: () => void;
  /**
   * 走ったことを入れる。
   *
   * **毎日いちばんよく使う操作を、1タップの位置に置く。**
   * これまで手で記録を入れる道はチャットしかなく、打つ手間に加えて
   * 1往復ぶんの費用がかかっていた。記録を入れるだけで相談の予算が減る、
   * というのは順番が逆。
   */
  onLog?: () => void;
}) {
  // 走らない日。**休む日を、失敗のように見せない。**
  const resting = !plan.running;
  /*
    強度を言う言葉。札では出さず、2行目に字で添える。

    **見出しがすでに言っているなら、二度言わない。**
    「イージー 10km」の下に「イージー」ともう一度出ると、画面の言葉が増えただけで
    分かることは1つも増えない。まだ記録が無い人には、指すものが無いので出さない。
  */
  const intensity =
    plan.source === 'start' || plan.headline.includes(INTENSITY_LABEL[plan.intensity])
      ? ''
      : INTENSITY_LABEL[plan.intensity];
  const sub = [intensity, plan.summary ?? plan.why].filter(Boolean).join('・');

  return (
    <div className="flex w-full items-center gap-2.5 border-b border-line px-4 py-2.5">
      <button
        type="button"
        onClick={onOpen}
        aria-label="今日やることを開く"
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="min-w-0 flex-1">
          {/*
            **見出しは色を持たない。** 強度の札も置かない。
            見出しがすでに「イージー 10km」と言っているので、札は同じ言葉をもう一度出すだけで、
            そのうえ橙の面を1つ増やす。橙は、押せるものに1つだけ残す。
          */}
          <span className="block truncate t-body font-bold">{plan.headline}</span>
          {/*
            **一行目だけで意味が通るようにする。** 補足は出るなら出す、で足りる。
            帯は2行までしか使わない。これ以上は本文を押し下げる。
          */}
          <span className="block truncate t-note leading-snug text-muted">{sub}</span>
        </span>

        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 shrink-0 text-muted"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>

      {/*
        **帯を増やさずに、ここへ置く。**
        案内の帯が並ぶと、その数だけ会話が画面の外へ出る。
        同じ行の中なら、1本も増えない。
      */}
      {onLog && (
        <button
          type="button"
          onClick={onLog}
          className={[
            'shrink-0 rounded-full px-3.5 py-1.5 t-note font-bold active:scale-[0.97]',
            /*
              **この画面でいちばん押される口。** 橙はここに取っておく。
              休む日は押す用事が無いので、色も引く。
            */
            resting ? 'bg-sunken' : 'bg-accent text-[var(--accent-fg)]',
          ].join(' ')}
        >
          走った
        </button>
      )}
    </div>
  );
}
