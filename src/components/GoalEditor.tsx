'use client';

import { useMemo, useState } from 'react';
import type { GoalKind, RunnerProfile } from '@/lib/types';
import {
  formatDuration,
  marathonPaceSeconds,
  parseDuration,
  summaryForTargetTime,
  targetTimeOptions,
  trainingPaces,
  vdotForTarget,
} from '@/lib/goals';

export interface ProfileEdit {
  goal: {
    kind: GoalKind;
    summary: string;
    targetTime?: string;
    targetPace?: string;
    raceName?: string;
    raceDate?: string;
  } | null;
  injuryHistory: string[];
  maxHr?: string;
  lthr?: string;
  restingHr?: string;
}

interface Props {
  profile: RunnerProfile | null;
  saving: boolean;
  onSave: (edit: ProfileEdit) => void;
  onCancel: () => void;
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  /** 必須なら true、任意なら false。省略した項目にはラベルを付けない。 */
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block py-2">
      <span className="text-[13px] font-medium">
        {label}
        {required !== undefined && (
          <span
            className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold ${
              required ? 'bg-accent-soft text-accent' : 'bg-sunken text-muted'
            }`}
          >
            {required ? '必須' : '任意'}
          </span>
        )}
      </span>
      {hint && <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

const inputClass =
  'w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-fg outline-none focus:border-[color:var(--accent)]';

export default function GoalEditor({ profile, saving, onSave, onCancel }: Props) {
  const goal = profile?.goal;
  const [kind, setKind] = useState<GoalKind>(goal?.kind ?? 'time');
  const [summary, setSummary] = useState(goal?.summary ?? '');
  const [targetTime, setTargetTime] = useState(goal?.targetTime ?? '');
  const [targetPace, setTargetPace] = useState(goal?.targetPace ?? '');
  const [raceName, setRaceName] = useState(goal?.raceName ?? '');
  const [raceDate, setRaceDate] = useState(goal?.raceDate ?? '');
  const [injuries, setInjuries] = useState((profile?.injuryHistory ?? []).join('\n'));
  const [maxHr, setMaxHr] = useState(profile?.maxHr ? String(profile.maxHr) : '');
  const [lthr, setLthr] = useState(profile?.lthr ? String(profile.lthr) : '');
  const [restingHr, setRestingHr] = useState(profile?.restingHr ? String(profile.restingHr) : '');

  const needsTime = kind === 'time' || kind === 'race';
  const timeIsValid = !targetTime.trim() || parseDuration(targetTime) !== undefined;

  const options = useMemo(() => targetTimeOptions(), []);
  const normalizedTime = useMemo(() => {
    const seconds = parseDuration(targetTime);
    return seconds === undefined ? '' : formatDuration(seconds);
  }, [targetTime]);
  // 選択肢に無いタイム（自由入力）を選んでいるかどうか。
  const isCustomTime = Boolean(targetTime.trim()) && !options.some((o) => o.value === normalizedTime);
  const [customTime, setCustomTime] = useState(isCustomTime);

  // 目標タイムを入れた瞬間に、コーチが使う基準が見えるようにする。
  const derived = useMemo(() => {
    if (!needsTime) return null;
    const seconds = marathonPaceSeconds(targetTime);
    if (seconds === undefined) return null;
    return trainingPaces(seconds);
  }, [needsTime, targetTime]);

  const vdot = useMemo(() => (needsTime ? vdotForTarget(targetTime) : undefined), [needsTime, targetTime]);

  const pickTime = (value: string) => {
    if (value === 'custom') {
      setCustomTime(true);
      return;
    }
    setCustomTime(false);
    setTargetTime(value);
    const seconds = parseDuration(value);
    // 目標名は選んだタイムから自動で作る。気に入らなければ下の欄で書き換えられる。
    if (seconds !== undefined) setSummary(summaryForTargetTime(seconds));
  };

  const KINDS: { value: GoalKind; label: string }[] = [
    { value: 'time', label: 'タイムを狙う' },
    { value: 'race', label: '完走したい' },
    { value: 'health', label: '健康維持・習慣化' },
  ];

  const submit = () => {
    if (!timeIsValid) return;
    onSave({
      goal: {
        kind,
        summary: summary.trim() || '目標',
        targetTime: needsTime ? targetTime.trim() || undefined : undefined,
        targetPace: needsTime ? targetPace.trim() || undefined : undefined,
        raceName: raceName.trim() || undefined,
        raceDate: raceDate.trim() || undefined,
      },
      injuryHistory: injuries.split('\n').map((line) => line.trim()).filter(Boolean),
      maxHr,
      lthr,
      restingHr,
    });
  };

  return (
    <div className="pb-4">
      <Field label="何を目指しますか" required hint="選ぶと、コーチが使う基準がそれに合わせて切り替わります">
        <div className="flex flex-wrap gap-2">
          {KINDS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => {
                setKind(item.value);
                // 目標名が空のままにならないよう、種類に合わせた既定を入れておく。
                if (!summary.trim()) {
                  if (item.value === 'race') setSummary('フルマラソン完走');
                  if (item.value === 'health') setSummary('健康維持と走る習慣の定着');
                }
              }}
              className={[
                'rounded-full border px-3.5 py-2 text-[13px] transition active:scale-[0.97]',
                kind === item.value
                  ? 'border-[color:var(--accent)] bg-accent-soft text-accent'
                  : 'border-line bg-bg text-fg',
              ].join(' ')}
            >
              {item.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="目標の表現" required={false} hint="自分の言葉に変えても構いません。空欄なら目標タイムから自動で作ります">
        <input
          className={inputClass}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="例: 来年の東京マラソンでサブ4"
        />
      </Field>

      {needsTime && (
        <>
          <Field label="目標タイム" required hint="1時間55分から5時間30分まで5分刻み。スクロールして選べます">
            <select
              className={`${inputClass} appearance-none`}
              value={customTime ? 'custom' : normalizedTime}
              onChange={(e) => pickTime(e.target.value)}
              aria-label="目標タイム"
            >
              <option value="">選んでください</option>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              <option value="custom">その他（自由入力）</option>
            </select>

            {customTime && (
              <input
                className={`${inputClass} mt-2`}
                value={targetTime}
                onChange={(e) => setTargetTime(e.target.value)}
                placeholder="2:48:30 のように 時:分:秒 で"
                inputMode="numeric"
              />
            )}

            {!timeIsValid && (
              <span className="mt-1 block text-[12px] text-warn">
                「2:48:30」のように、時:分:秒 の形で入力してください。
              </span>
            )}
          </Field>

          {derived && (
            <div className="my-2 rounded-xl bg-sunken px-3 py-2.5 text-[12px] leading-relaxed text-muted">
              <p className="font-medium text-fg">この目標での基準ペース</p>
              <p>レースペース {derived.marathon} / 閾値走 {derived.threshold} / インターバル {derived.interval}</p>
              <p>イージー {derived.easyFrom} 〜 {derived.easyTo}</p>
              {vdot !== undefined && (
                <p className="mt-1">
                  必要な VDOT ≒ <span className="font-semibold text-fg">{vdot.toFixed(1)}</span>
                  <span className="block text-[11px]">目標タイムから自動計算される走力指標です</span>
                </p>
              )}
            </div>
          )}

          <Field label="目標ペース" required={false} hint="空欄なら目標タイムから自動計算します">
            <input
              className={inputClass}
              value={targetPace}
              onChange={(e) => setTargetPace(e.target.value)}
              placeholder={derived ? derived.marathon : '5:41/km'}
            />
          </Field>

          <div className="flex gap-2">
            <div className="flex-1">
              <Field label="大会名" required={false}>
                <input className={inputClass} value={raceName} onChange={(e) => setRaceName(e.target.value)} placeholder="東京マラソン" />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="本番の日" required={false}>
                <input className={inputClass} type="date" value={raceDate} onChange={(e) => setRaceDate(e.target.value)} />
              </Field>
            </div>
          </div>
        </>
      )}

      <Field
        label="故障歴・気になる部位"
        required={false}
        hint="1行に1件。負荷を上げる判断のたびにコーチが必ず考慮します"
      >
        <textarea
          className={`${inputClass} min-h-[88px] resize-y`}
          value={injuries}
          onChange={(e) => setInjuries(e.target.value)}
          placeholder={'右膝の外側（腸脛靭帯炎、2年前）\n左アキレス腱が張りやすい'}
        />
      </Field>

      <Field
        label="最大心拍数"
        required
        hint="Garmin等で計測した最高心拍数。不明なら「220 − 年齢」が目安です"
      >
        <input
          className={inputClass}
          value={maxHr}
          onChange={(e) => setMaxHr(e.target.value)}
          placeholder="189"
          inputMode="numeric"
        />
        {!maxHr.trim() && (
          <span className="mt-1 block text-[11px] leading-relaxed text-warn">
            未設定でも保存できますが、心拍ゾーンの評価ができません。
          </span>
        )}
      </Field>

      <Field
        label="LTHR（乳酸閾値心拍数）"
        required={false}
        hint="分からない場合は空欄でOK。最大心拍数から推定して計算します"
      >
        <input
          className={inputClass}
          value={lthr}
          onChange={(e) => setLthr(e.target.value)}
          placeholder={maxHr.trim() ? `${Math.round(Number(maxHr) * 0.89) || ''}（推定値）` : '172'}
          inputMode="numeric"
        />
      </Field>

      <Field
        label="安静時心拍数"
        required={false}
        hint="睡眠時・起床時の心拍数。分からない場合は空欄でOK。入力するとゾーンの精度が上がります"
      >
        <input
          className={inputClass}
          value={restingHr}
          onChange={(e) => setRestingHr(e.target.value)}
          placeholder="44"
          inputMode="numeric"
        />
      </Field>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={saving || !timeIsValid}
          className="flex-1 rounded-full bg-accent px-4 py-3 text-[14px] font-semibold text-[var(--accent-fg)] disabled:opacity-40"
        >
          {saving ? '保存しています…' : '保存する'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex-1 rounded-full border border-line px-4 py-3 text-[14px]"
        >
          やめる
        </button>
      </div>
    </div>
  );
}
