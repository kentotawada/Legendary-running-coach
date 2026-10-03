'use client';

import { useMemo, useState } from 'react';
import Sheet from './Sheet';
import type { ActivityLog, RunnerProfile } from '@/lib/types';
import {
  SESSION_KINDS,
  type SessionKindId,
  clock,
  dayChoices,
  distanceChoices,
  guessSeconds,
  paceOf,
  toWorkout,
} from '@/lib/quicklog';
import { compareWithPast, describeComparison } from '@/lib/compare';

/**
 * 走ったことを、数タップで入れる画面。
 *
 * **これまで、手で記録を入れる道はチャットしか無かった。**
 * 「今日10km走りました」と打つ道で、1往復 ¥4.32 かかり、
 * スマホで日本語を打つ時間もかかる。走り終えた直後にやる作業ではない。
 *
 * ここはモデルを呼ばない。距離と時間を送って終わり。**0円。**
 *
 * 入れたあとに、その場で過去の自分と比べたものを出す。
 * **これも0円。** 比較はこちらの計算なので、聞かなくても出せる。
 */
export default function QuickLogSheet({
  profile,
  plannedKm,
  plannedKind,
  saving,
  onSave,
  onAsk,
  onClose,
}: {
  profile: RunnerProfile | null;
  /** 今日の予定の距離。たいていこの通りに走るので、先に入れておく。 */
  plannedKm?: number;
  /** 今日の予定の種類。 */
  plannedKind?: SessionKindId;
  saving?: boolean;
  /** 送る。入った記録を返す（比較に使う）。失敗したら理由を投げる。 */
  onSave: (input: {
    date: string;
    km: number;
    seconds?: number;
    kind?: SessionKindId;
  }) => Promise<{ profile: RunnerProfile; activity: ActivityLog | null; message?: string }>;
  /** コーチに見てもらう。**ここだけが、お金のかかる操作。** */
  onAsk: (message: string) => void;
  onClose: () => void;
}) {
  const now = useMemo(() => new Date(), []);
  const days = useMemo(() => dayChoices(now), [now]);
  const choices = useMemo(() => distanceChoices(profile, plannedKm, now), [profile, plannedKm, now]);

  const [ago, setAgo] = useState(0);
  /** 予定があればその距離、無ければいちばんよく走る距離から始める。 */
  const [km, setKm] = useState(() => plannedKm ?? choices[Math.floor(choices.length / 2)] ?? 5);
  /**
   * 時間は**普段のペースから先に埋めておく。**
   * 当たっていなくてよい。ゼロから打つのと、押して直すのとでは、速さが違う。
   */
  const [seconds, setSeconds] = useState<number | null>(
    () => guessSeconds(profile, plannedKm ?? choices[Math.floor(choices.length / 2)] ?? 5, now) ?? null,
  );
  /** 時間を手で打っている間の文字。押して直す道と、打つ道の両方を残す。 */
  const [typing, setTyping] = useState<string | null>(null);
  const [kind, setKind] = useState<SessionKindId | undefined>(plannedKind);

  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    activity: ActivityLog | null;
    profile: RunnerProfile;
    message?: string;
  } | null>(null);

  /** 距離を変えたら、時間も一緒に置き直す。**手で触っていない間だけ。** */
  const pickKm = (next: number) => {
    const rounded = Math.round(Math.min(100, Math.max(0.1, next)) * 10) / 10;
    setKm(rounded);
    if (typing === null) setSeconds(guessSeconds(profile, rounded, now) ?? null);
  };

  const commitTyping = () => {
    if (typing === null) return;
    const parsed = parseClock(typing);
    setSeconds(parsed);
    setTyping(null);
  };

  const pace = seconds !== null ? paceOf(km, seconds) : undefined;

  const save = async () => {
    setError(null);
    const workout = toWorkout({ date: days[ago].date, km, seconds: seconds ?? undefined, kind });
    if (!workout) {
      setError('距離を入れてください。');
      return;
    }
    try {
      const result = await onSave({
        date: days[ago].date,
        km,
        seconds: seconds ?? undefined,
        kind,
      });
      setDone(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存できませんでした。通信を確かめてください。');
    }
  };

  /*
    保存したあと。**ここで「ありがとうございます」で終わらせない。**
    入れた直後がいちばん知りたい時で、比較はこちらの計算なので無料で出せる。
  */
  if (done) {
    const comparison = done.activity ? compareWithPast(done.profile, done.activity) : null;
    const described = comparison ? describeComparison(comparison) : null;
    const logged = done.activity;

    return (
      <Sheet label="記録を入れました" title="入りました" onClose={onClose}>
        <div className="rounded-[16px] bg-accent-soft px-4 py-3.5">
          <p className="t-title font-bold leading-snug text-accent tabular-nums">
            {logged?.distanceKm ?? km}km
            {logged?.durationMin ? ` ${clock((logged.durationMin ?? 0) * 60)}` : ''}
          </p>
          <p className="mt-1 t-note text-muted">
            {days[ago].label}
            {logged?.metrics?.avgPace ? ` ・ ${logged.metrics.avgPace}` : pace ? ` ・ ${pace}` : ''}
          </p>
        </div>

        {described ? (
          <div className="mt-3 rounded-[14px] bg-sunken px-3.5 py-3">
            <p className="t-note font-bold">{described.title}</p>
            <p className="mt-1 t-note leading-relaxed text-muted">{described.detail}</p>
          </div>
        ) : (
          <p className="mt-3 t-note leading-relaxed text-muted">
            同じくらいの距離の記録がもう少し貯まると、過去の自分と比べたものが、ここに出ます。
          </p>
        )}

        {done.message && (
          <p className="mt-3 t-note leading-relaxed text-muted">{done.message}</p>
        )}

        {/*
          **コーチを呼ぶかどうかは、本人に決めてもらう。**
          ここまでは0円。押した時だけ、1往復ぶんかかる。
        */}
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              onClose();
              onAsk(
                `${days[ago].label}、${km}km を${seconds ? clock(seconds) : ''}で走りました。この練習をどう見ますか。`,
              );
            }}
            className="rounded-full bg-accent px-4 py-2.5 t-note font-bold text-[var(--accent-fg)] active:scale-[0.98]"
          >
            コーチに見てもらう
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-sunken px-4 py-2.5 t-note font-semibold active:scale-[0.98]"
          >
            閉じる
          </button>
        </div>
        <p className="mt-2 t-note leading-relaxed text-muted">
          記録を入れるだけなら、コーチは呼びません。
        </p>
      </Sheet>
    );
  }

  return (
    <Sheet label="走ったことを入れる" title="走った" onClose={onClose}>
      {/* いつ走ったか。**昨日ぶんを後から入れる人は多い。** */}
      <div className="flex gap-2">
        {days.map((day) => (
          <button
            key={day.ago}
            type="button"
            onClick={() => setAgo(day.ago)}
            className={[
              'rounded-full px-3.5 py-2 t-note font-semibold active:scale-[0.98]',
              day.ago === ago
                ? 'bg-accent text-[var(--accent-fg)]'
                : 'bg-sunken text-muted',
            ].join(' ')}
          >
            {day.label}
          </button>
        ))}
      </div>

      {/* 距離。**その人がいつも走る距離を札にする。** */}
      <div className="mt-5">
        <p className="t-note font-bold">距離</p>
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={() => pickKm(km - 0.1)}
            aria-label="距離を0.1km減らす"
            className="h-11 w-11 shrink-0 rounded-full bg-sunken t-title font-bold active:scale-[0.96]"
          >
            −
          </button>
          <p className="min-w-0 flex-1 text-center t-num-l font-bold leading-none tabular-nums">
            {km.toFixed(1)}
            <span className="ml-1 t-body font-medium text-muted">km</span>
          </p>
          <button
            type="button"
            onClick={() => pickKm(km + 0.1)}
            aria-label="距離を0.1km増やす"
            className="h-11 w-11 shrink-0 rounded-full bg-sunken t-title font-bold active:scale-[0.96]"
          >
            ＋
          </button>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {choices.map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => pickKm(choice)}
              className={[
                'rounded-full px-3 py-1.5 t-note font-semibold tabular-nums active:scale-[0.98]',
                Math.abs(choice - km) < 0.05
                  ? 'bg-accent text-[var(--accent-fg)]'
                  : 'bg-sunken text-muted',
              ].join(' ')}
            >
              {choice % 1 === 0 ? choice : choice.toFixed(1)}km
            </button>
          ))}
        </div>
      </div>

      {/* 時間。**普段のペースから埋めてある。** */}
      <div className="mt-5">
        <div className="flex items-baseline justify-between">
          <p className="t-note font-bold">時間</p>
          {pace && <p className="t-note text-muted tabular-nums">{pace}</p>}
        </div>

        <div className="mt-2 flex items-center gap-2">
          {typing === null ? (
            <button
              type="button"
              onClick={() => setTyping(seconds !== null ? clock(seconds) : '')}
              className="min-w-0 flex-1 rounded-[14px] bg-sunken py-3 text-center t-num font-bold leading-none tabular-nums active:scale-[0.99]"
            >
              {seconds !== null ? (
                clock(seconds)
              ) : (
                <span className="t-body font-medium text-muted">押して入れる</span>
              )}
            </button>
          ) : (
            <input
              // 数字と「:」だけ。**スマホで日本語の入力に切り替わらないようにする。**
              inputMode="numeric"
              autoFocus
              value={typing}
              onChange={(event) => setTyping(event.target.value.replace(/[^\d:]/g, ''))}
              onBlur={commitTyping}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitTyping();
              }}
              placeholder="52:30"
              aria-label="かかった時間"
              className="min-w-0 flex-1 rounded-[14px] bg-sunken py-3 text-center t-num font-bold tabular-nums outline-none ring-2 ring-[color:var(--accent)]"
            />
          )}
        </div>

        {typing === null && (
          <div className="mt-2 flex flex-wrap gap-2">
            {[
              { label: '−1分', delta: -60 },
              { label: '−10秒', delta: -10 },
              { label: '＋10秒', delta: 10 },
              { label: '＋1分', delta: 60 },
            ].map((step) => (
              <button
                key={step.label}
                type="button"
                onClick={() => setSeconds(Math.max(0, (seconds ?? 0) + step.delta))}
                className="rounded-full bg-sunken px-3 py-1.5 t-note font-semibold tabular-nums active:scale-[0.98]"
              >
                {step.label}
              </button>
            ))}
            {seconds !== null && (
              <button
                type="button"
                onClick={() => setSeconds(null)}
                className="rounded-full px-3 py-1.5 t-note text-muted underline underline-offset-4"
              >
                わからない
              </button>
            )}
          </div>
        )}
        {/* **時間が無くても保存できる。** 距離だけでも、週の量としては意味がある。 */}
        <p className="mt-2 t-note leading-relaxed text-muted">
          いつものペースから入れてあります。違っていれば直してください。
        </p>
      </div>

      {/* 種類。**選ばなくても保存できる。** */}
      <div className="mt-5">
        <p className="t-note font-bold">
          種類 <span className="font-normal text-muted">（任意）</span>
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {SESSION_KINDS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setKind(kind === item.id ? undefined : item.id)}
              className={[
                'rounded-full px-3 py-1.5 t-note font-semibold active:scale-[0.98]',
                kind === item.id
                  ? 'bg-accent text-[var(--accent-fg)]'
                  : 'bg-sunken text-muted',
              ].join(' ')}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-[12px] bg-warn-soft px-3.5 py-2.5 t-note leading-relaxed text-warn">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || km <= 0}
        className="mt-5 w-full rounded-full bg-accent py-3.5 t-body font-bold text-[var(--accent-fg)] active:scale-[0.99] disabled:opacity-40"
      >
        {saving ? '入れています…' : '入れる'}
      </button>
      <p className="mt-2 text-center t-note leading-relaxed text-muted">
        コーチは呼びません。入れた直後に、過去の自分との比較が出ます。
      </p>
    </Sheet>
  );
}

/** 「52:30」「1:52:30」「5230」を秒に。読めなければ null。 */
function parseClock(value: string): number | null {
  const text = value.trim();
  if (!text) return null;

  if (text.includes(':')) {
    const parts = text.split(':').map((part) => Number(part));
    if (parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
    const [a, b, c] = parts;
    if (parts.length === 2) return Math.round(a * 60 + b);
    if (parts.length === 3) return Math.round(a * 3600 + b * 60 + c);
    return null;
  }

  // 「:」が無い時は分として読む。「50」は50分。
  const minutes = Number(text);
  return Number.isFinite(minutes) && minutes >= 0 ? Math.round(minutes * 60) : null;
}
