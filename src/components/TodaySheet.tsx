'use client';

import type { TodayPlan } from '@/lib/today';
import { INTENSITY_LABEL } from '@/lib/today';
import Sheet from './Sheet';

/**
 * 今日やることの中身。
 *
 * **「なぜ今日それなのか」を必ず出す。** 時計のサジェストも固定のメニュー表も、
 * 何をやるかは出すが、理由は出さない。理由が無い指示は、守れなかった日に
 * 「合わなかった」ではなく「自分がだめだった」になる。
 *
 * そして**崩せるようにしておく。** 守れない予定は、守れなかった日に
 * アプリを開かない理由になる。先に逃げ道を置いて、最後は会話に戻す。
 */
export default function TodaySheet({
  plan,
  onClose,
  onAsk,
}: {
  plan: TodayPlan;
  onClose: () => void;
  /** コーチに相談へ回す。押した言葉がそのまま送られる。 */
  onAsk: (message: string) => void;
}) {
  const ask = (message: string) => {
    onClose();
    onAsk(message);
  };

  return (
    <Sheet label="今日やること" title="今日やること" onClose={onClose}>
      <div
        className={[
          'rounded-[16px] border px-4 py-3.5',
          plan.running ? 'border-[color:var(--accent)] bg-accent-soft' : 'border-line bg-sunken',
        ].join(' ')}
      >
        <p className="flex items-center gap-2">
          <span
            className={[
              'rounded-full px-2 py-0.5 text-[10px] font-bold',
              plan.running ? 'bg-accent text-[var(--accent-fg)]' : 'bg-bg text-muted',
            ].join(' ')}
          >
            {INTENSITY_LABEL[plan.intensity]}
          </span>
          {plan.summary && <span className="text-[12px] text-muted">{plan.summary}</span>}
        </p>
        <p className={`mt-1.5 text-[19px] font-bold leading-snug ${plan.running ? 'text-accent' : ''}`}>
          {plan.headline}
        </p>
      </div>

      {/* **理由を、手順より先に置く。** 納得していない手順は、途中で止まる。 */}
      <div className="mt-4">
        <p className="text-[13px] font-bold">なぜ今日これなのか</p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">{plan.why}</p>
      </div>

      <div className="mt-5">
        <p className="text-[13px] font-bold">やること</p>
        <ol className="mt-2 space-y-2">
          {plan.steps.map((step, index) => (
            <li key={`${step.label}-${index}`} className="flex gap-2.5">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sunken text-[11px] font-bold tabular-nums text-muted">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold">{step.label}</span>
                {step.detail && (
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">
                    {step.detail}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {plan.alternatives.length > 0 && (
        <div className="mt-5">
          <p className="text-[13px] font-bold">できない日のために</p>
          <ul className="mt-2 space-y-1.5">
            {plan.alternatives.map((alternative) => (
              <li
                key={alternative.when}
                className="rounded-[12px] bg-sunken px-3 py-2 text-[12px] leading-relaxed"
              >
                <strong className="font-semibold">{alternative.when}</strong>
                <span className="text-muted"> … {alternative.what}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        **ここが、固定のメニュー表との違い。**
        押せば会話になり、その場で組み直せる。崩せる予定だけが、続く。
      */}
      <div className="mt-6">
        <p className="text-[13px] font-bold">合わないときは、言ってください</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {[
            { label: '今日はきつい', message: '今日は体がきついです。メニューを変えられますか。' },
            { label: '時間がない', message: '今日は時間が取れません。短くできますか。' },
            { label: '脚が痛い', message: '脚に痛みがあります。どうすればいいですか。' },
            { label: 'もっとやりたい', message: 'もう少しやれそうです。増やしても大丈夫ですか。' },
          ].map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={() => ask(chip.message)}
              className="rounded-full border border-line px-3.5 py-2 text-[13px] font-semibold active:scale-[0.98]"
            >
              {chip.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          押すと、そのままコーチに相談できます。
          <strong className="font-semibold text-fg">決めたことは、その場で変えられます。</strong>
        </p>
      </div>
    </Sheet>
  );
}
