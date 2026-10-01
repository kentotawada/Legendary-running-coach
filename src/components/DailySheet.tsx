'use client';

import { useState } from 'react';
import type { DailyStatus } from '@/lib/daily';
import { MEASURE_NOTE, isBodyFatInRange } from '@/lib/composition';
import { MILESTONES } from '@/lib/daily';
import Sheet from './Sheet';
import StampIcon from './StampIcon';

interface Props {
  daily: DailyStatus;
  saving: boolean;
  onSaveWeight: (weightKg: number, bodyFatPercent?: number) => void;
  /** 食べた量を足す。**1回で入れ切らせない。** */
  onAddIntake: (kcal: number) => void;
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

/**
 * 一食ぶんの目安。
 *
 * **数字を打たせない。** ここで要る精度は「基礎代謝を下回っているか」が
 * 分かる程度で、1kcal単位の正確さには意味が無い。
 * 打つ手間のほうが、記録が続かなくなる原因として大きい。
 */
const MEALS = [
  { label: '軽め', kcal: 300 },
  { label: 'ふつう', kcal: 600 },
  { label: 'しっかり', kcal: 900 },
] as const;

export default function DailySheet({
  daily,
  saving,
  onSaveWeight,
  onOpenRunForm,
  onOpenForm,
  onClose,
  onAddIntake,
}: Props) {
  const [weight, setWeight] = useState(daily.latestWeightKg ? String(daily.latestWeightKg) : '');
  const parsed = Number(weight);
  /**
   * 体脂肪率。**体組成計を持っている人だけのための欄なので、たたんでおく。**
   * 最初から2つ並んでいると、持っていない人に「片方しか埋められない」と思わせる。
   */
  /** **一度でも入れた人は、体組成計を持っている。** 次からは開いたまま出す。 */
  const [fatOpen, setFatOpen] = useState(daily.latestBodyFatPercent !== undefined);
  const [fat, setFat] = useState(
    daily.latestBodyFatPercent !== undefined ? String(daily.latestBodyFatPercent) : '',
  );
  const fatValue = Number(fat);
  const fatOk = fat.trim() === '' || (Number.isFinite(fatValue) && isBodyFatInRange(fatValue));
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

          {/*
            **食べた量。1回で入れ切らせない。**
            1日ぶんをまとめて思い出すのは難しく、夜にまとめて入れる形にすると
            入れ忘れた日がそのまま空になる。食べたその場で、ひと押しで足せるようにする。
            **数字を打たせない。** ざっくりで十分な精度しか要らないので、
            打たせること自体が無駄な手間になる。
          */}
          <div className="mt-5 border-t border-line pt-4">
            <div className="flex items-baseline justify-between">
              <p className="text-[13px] font-medium">今日 食べた量</p>
              <p className="text-[15px] font-bold tabular-nums">
                {(daily.intakeKcalToday ?? 0).toLocaleString('ja-JP')}
                <span className="ml-0.5 text-[11px] font-medium text-muted">kcal</span>
              </p>
            </div>
            <div className="mt-2 flex gap-2">
              {MEALS.map((meal) => (
                <button
                  key={meal.label}
                  type="button"
                  disabled={saving}
                  onClick={() => onAddIntake(meal.kcal)}
                  className="min-w-0 flex-1 rounded-[14px] border border-line px-2 py-2.5 text-center active:scale-[0.97] disabled:opacity-40"
                >
                  <span className="block text-[13px] font-semibold">{meal.label}</span>
                  <span className="block text-[11px] text-muted tabular-nums">＋{meal.kcal}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              食べるたびに押してください。ざっくりで十分です。
              細かく伝えたい時は、コーチに話せば読み取ります。
            </p>
          </div>

          <div className="mt-5 border-t border-line pt-4">
            {/*
              **同じことを2回言わない。** 上のスタンプの行に
              「増えた減ったは気にしない。乗ることが習慣です」と既に出ている。
              ここでもう一度、長く言い直す必要は無い。
            */}
            <p className="text-[13px] font-medium">体重をはかる</p>
            <div className="mt-2 flex gap-2">
              <label className="min-w-0 flex-1">
                <span className="sr-only">体重(kg)</span>
                <input
                  className="w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-fg outline-none focus:border-[color:var(--accent)]"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  placeholder="61.4"
                  inputMode="decimal"
                  aria-label="体重(kg)"
                />
              </label>
              {/* 体脂肪率を、体重の隣に。**持っている人には、2つで1つの動作。** */}
              {fatOpen && (
                <label className="min-w-0 flex-1">
                  <span className="sr-only">体脂肪率(%)</span>
                  <input
                    className="w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-fg outline-none focus:border-[color:var(--accent)]"
                    value={fat}
                    onChange={(e) => setFat(e.target.value)}
                    placeholder="18.5 %"
                    inputMode="decimal"
                    aria-label="体脂肪率(%)"
                  />
                </label>
              )}
              <button
                type="button"
                disabled={!valid || !fatOk || saving}
                onClick={() =>
                  onSaveWeight(
                    Math.round(parsed * 10) / 10,
                    fat.trim() === '' ? undefined : Math.round(fatValue * 10) / 10,
                  )
                }
                className="shrink-0 rounded-full bg-accent px-5 py-2.5 text-[14px] font-semibold text-[var(--accent-fg)] disabled:opacity-40"
              >
                {saving ? '保存中' : '記録'}
              </button>
            </div>

            {/*
              体組成計を持っている人だけの欄。
              **同じ「3kg減」でも、脂肪が減ったのか筋肉が減ったのかで意味が正反対。**
              体重だけでは見分けられず、後者は疲労骨折と貧血の入口になる。
            */}
            {fatOpen ? (
              <>
                {!fatOk && (
                  <p className="mt-1.5 text-[11px] text-warn">体脂肪率は 3〜60% の範囲で入れてください。</p>
                )}
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{MEASURE_NOTE}</p>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setFatOpen(true)}
                className="mt-2.5 text-[12px] text-accent underline underline-offset-4"
              >
                体組成計の体脂肪率も入れる
              </button>
            )}
          </div>
    </Sheet>
  );
}
