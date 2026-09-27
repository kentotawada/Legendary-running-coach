'use client';

import { useState } from 'react';
import type { DailyStatus } from '@/lib/daily';
import { MILESTONES } from '@/lib/daily';
import Sheet from './Sheet';
import StampIcon from './StampIcon';

interface Props {
  daily: DailyStatus;
  saving: boolean;
  onSaveWeight: (weightKg: number) => void;
  /** 「走りを見てもらう」へ。渡さなければ出さない。 */
  onOpenRunForm?: () => void;
  /** 「ストレッチ・筋トレを見てもらう」へ。 */
  onOpenForm?: () => void;
  onClose: () => void;
}

/** 次の節目までの距離が見えると、あと一日が続けやすくなる。 */
function nextMilestone(streak: number): number | undefined {
  return MILESTONES.find((value) => value > streak);
}

export default function DailySheet({
  daily,
  saving,
  onSaveWeight,
  onOpenRunForm,
  onOpenForm,
  onClose,
}: Props) {
  const [weight, setWeight] = useState(daily.latestWeightKg ? String(daily.latestWeightKg) : '');
  const parsed = Number(weight);
  const valid = Number.isFinite(parsed) && parsed >= 20 && parsed <= 250;
  const next = nextMilestone(daily.streakDays);

  return (
    <Sheet label="今日のスタンプ" title="今日のスタンプ" onClose={onClose}>

          {daily.milestone && (
            /*
              **絵文字で祝わない。** 端末ごとに絵柄が変わるうえ、
              ここに 🎉 を置くと、文章のほうが軽く見える。
              数字を大きく出すだけで、祝いにはじゅうぶん足りる。
            */
            <div className="mb-4 animate-rise rounded-[var(--radius)] border border-[color:var(--accent)] bg-accent-soft px-4 py-3.5">
              <p className="text-[13px] font-bold text-accent">
                {daily.milestone}日連続です。
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-accent opacity-90">
                続けられていること自体が、いちばん再現しにくい才能です。
              </p>
            </div>
          )}

          <div className="mb-4 flex items-baseline gap-2">
            <span className="text-[32px] font-bold leading-none text-accent tabular-nums">
              {daily.streakDays}
            </span>
            {/*
              **1日目を「1日連続」と言わない。** まだ何も続いていない。
              「1日目」なら嘘にならず、始まったことは伝わる。
            */}
            <span className="text-[13px] text-muted">
              {daily.streakDays >= 2 ? '日連続' : '日目'}
            </span>
            {next && (
              <span className="ml-auto text-[12px] text-muted">
                次の節目まで あと{next - daily.streakDays}日
              </span>
            )}
          </div>

          <ul className="space-y-2">
            {daily.stamps.map((stamp) => (
              <li
                key={stamp.id}
                className={[
                  'flex items-center gap-3 rounded-[var(--radius)] border px-3.5 py-3',
                  stamp.done ? 'border-[color:var(--accent)] bg-accent-soft' : 'border-line bg-bg',
                ].join(' ')}
              >
                {/* 押せた時は色が変わるだけ。絵柄は変えない。 */}
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center ${
                    stamp.done ? 'text-accent' : 'text-muted opacity-45'
                  }`}
                >
                  <StampIcon id={stamp.id} size={28} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-[14px] font-semibold ${stamp.done ? 'text-accent' : ''}`}>
                    {stamp.label}
                  </span>
                  <span className="block text-[11px] leading-relaxed text-muted">{stamp.hint}</span>
                </span>
                {stamp.done && <span className="shrink-0 text-[13px] font-bold text-accent">済</span>}
              </li>
            ))}
          </ul>

          {/*
            **スタンプと道具を混ぜない。** 上の3つは「押すと埋まるもの」、
            ここから下は「開くと始まるもの」。同じ見た目で続けて並べると、
            押しても埋まらないスタンプがあるように見える。
            走りが主。ストレッチ・筋トレはその次。並び順でそう見せる。
          */}
          {(onOpenRunForm || onOpenForm) && (
            <div className="mt-5 border-t border-line pt-4">
              <p className="text-[13px] font-medium">コーチに見てもらう</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                スタンプとは別に、いつでも使えます
              </p>
            </div>
          )}

          {onOpenRunForm && (
            <button
              type="button"
              onClick={onOpenRunForm}
              className="mt-2 flex w-full items-center gap-3 rounded-[var(--radius)] border border-[color:var(--accent)] bg-accent-soft px-3.5 py-3 text-left active:opacity-70"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-accent">走りを見てもらう</span>
                <span className="block text-[11px] leading-relaxed text-muted">
                  横から数秒撮った動画から、接地の位置やピッチを数字にします
                </span>
              </span>
              <span className="shrink-0 text-[13px] text-accent">›</span>
            </button>
          )}

          {onOpenForm && (
            <button
              type="button"
              onClick={onOpenForm}
              className="mt-2 flex w-full items-center gap-3 rounded-[var(--radius)] border border-line bg-bg px-3.5 py-3 text-left active:opacity-70"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold">ストレッチ・筋トレを見てもらう</span>
                <span className="block text-[11px] leading-relaxed text-muted">
                  カメラに映すと、その場で形を見ます
                </span>
              </span>
              <span className="shrink-0 text-[13px] text-muted">›</span>
            </button>
          )}

          <div className="mt-5 border-t border-line pt-4">
            {/*
              **同じことを2回言わない。** 上のスタンプの行に
              「増えた減ったは気にしない。乗ることが習慣です」と既に出ている。
              ここでもう一度、長く言い直す必要は無い。
            */}
            <p className="text-[13px] font-medium">体重をはかる</p>
            <div className="mt-2 flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 py-2.5 text-fg outline-none focus:border-[color:var(--accent)]"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="61.4"
                inputMode="decimal"
                aria-label="体重(kg)"
              />
              <button
                type="button"
                disabled={!valid || saving}
                onClick={() => onSaveWeight(Math.round(parsed * 10) / 10)}
                className="shrink-0 rounded-full bg-accent px-5 py-2.5 text-[14px] font-semibold text-[var(--accent-fg)] disabled:opacity-40"
              >
                {saving ? '保存中' : '記録'}
              </button>
            </div>
          </div>
    </Sheet>
  );
}
