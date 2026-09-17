'use client';

import { useState } from 'react';
import type { DailyStatus } from '@/lib/daily';
import { MILESTONES } from '@/lib/daily';

interface Props {
  daily: DailyStatus;
  saving: boolean;
  onSaveWeight: (weightKg: number) => void;
  onClose: () => void;
}

/** 次の節目までの距離が見えると、あと一日が続けやすくなる。 */
function nextMilestone(streak: number): number | undefined {
  return MILESTONES.find((value) => value > streak);
}

export default function DailySheet({ daily, saving, onSaveWeight, onClose }: Props) {
  const [weight, setWeight] = useState(daily.latestWeightKg ? String(daily.latestWeightKg) : '');
  const parsed = Number(weight);
  const valid = Number.isFinite(parsed) && parsed >= 20 && parsed <= 250;
  const next = nextMilestone(daily.streakDays);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/45"
      role="dialog"
      aria-modal="true"
      aria-label="今日のスタンプ"
    >
      <button type="button" className="flex-1" aria-label="閉じる" onClick={onClose} />

      <div className="safe-bottom max-h-[82dvh] animate-rise overflow-y-auto rounded-t-3xl border-t border-line bg-elevated">
        <div className="sticky top-0 flex items-center justify-between border-b border-line bg-elevated px-5 py-4">
          <h2 className="text-[16px] font-bold">今日のスタンプ</h2>
          <button type="button" onClick={onClose} className="rounded-full px-3 py-1.5 text-[13px] text-muted">
            閉じる
          </button>
        </div>

        <div className="px-5 pb-8 pt-3">
          {daily.milestone && (
            <div className="mb-3 animate-rise rounded-[var(--radius)] border border-[color:var(--accent)] bg-accent-soft px-4 py-3 text-[13px] leading-relaxed text-accent">
              🎉 <strong className="font-bold">{daily.milestone}日連続です。</strong>{' '}
              続けられていること自体が、いちばん再現しにくい才能です。
            </div>
          )}

          <div className="mb-4 flex items-baseline gap-2">
            <span className="text-[32px] font-bold leading-none text-accent tabular-nums">
              {daily.streakDays}
            </span>
            <span className="text-[13px] text-muted">日連続</span>
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
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg ${
                    stamp.done ? '' : 'opacity-40 grayscale'
                  }`}
                >
                  {stamp.emoji}
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

          <div className="mt-5 border-t border-line pt-4">
            <p className="text-[13px] font-medium">体重をはかる</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
              増えた減ったは気にしなくて大丈夫です。日々1〜2kgは水分で動きます。
              毎日乗ること自体が、体の変化に早く気づく力になります。
            </p>
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
        </div>
      </div>
    </div>
  );
}
