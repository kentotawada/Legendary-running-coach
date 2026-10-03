'use client';

import type { TodayPlan } from '@/lib/today';
import { INTENSITY_LABEL } from '@/lib/today';
import { useState } from 'react';
import type { WeekDay, WeekPlan } from '@/lib/week';
import type { ComebackPlan } from '@/lib/comeback';
import Sheet from './Sheet';
import WeekStrip from './WeekStrip';
import ComebackPanel from './ComebackPanel';
import WeatherAsk from './WeatherAsk';
import PacePlanPanel from './PacePlanPanel';
import type { PacePlan } from '@/lib/pacing';
import type { ShoePick } from '@/lib/rotation';

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
  week,
  comeback,
  pacing,
  shoe,
  askLocation,
  onAllowLocation,
  onClose,
  onAsk,
}: {
  plan: TodayPlan;
  /** この先7日。今日だけでは、計画の置き場所にならない。 */
  week?: WeekPlan | null;
  /** 走れない時の段取り。走れる日は null。 */
  comeback?: ComebackPlan | null;
  /** 大会が近い時の、当日のペース配分。 */
  pacing?: PacePlan | null;
  /** 今日はどの靴で走るか。 */
  shoe?: ShoePick | null;
  /** まだ場所を聞いていないか。聞いてよい時だけ true。 */
  askLocation?: boolean;
  onAllowLocation?: (lat: number, lon: number) => void;
  onClose: () => void;
  /** コーチに相談へ回す。押した言葉がそのまま送られる。 */
  onAsk: (message: string) => void;
}) {
  const ask = (message: string) => {
    onClose();
    onAsk(message);
  };

  /**
   * 週の1日を押して、動かす。
   *
   * **見るだけの並びは、他のアプリと同じ。**
   * 「日曜は出かけるので土曜にロングを移したい」——この一言のために、
   * いまは自分で打つしかない。押して選べば、同じ文が1通で送られる。
   *
   * 送るのは**必ず1通**。選び直しのたびに送っていたら、1通¥4.32が積み上がる。
   */
  const [picked, setPicked] = useState<WeekDay | null>(null);
  const [moving, setMoving] = useState(false);

  const describe = (day: WeekDay) =>
    `${Number(day.date.slice(5, 7))}月${Number(day.date.slice(8, 10))}日（${day.weekday}）の${day.note ?? day.label}`;

  const pickDay = (day: WeekDay) => {
    if (moving && picked && day.date !== picked.date) {
      ask(
        `${describe(picked)}を、${Number(day.date.slice(5, 7))}月${Number(day.date.slice(8, 10))}日（${day.weekday}）に移したいです。` +
          'そのぶん、ほかの日はどう組み替えればいいですか。',
      );
      return;
    }
    setMoving(false);
    setPicked(picked?.date === day.date ? null : day);
  };

  /*
    見出しの下の1行。強度と、ペースの幅。

    **見出しがすでに言っている言葉は、二度出さない。**
    「イージー 10km」の上に「イージー」の札を置いても、分かることは1つも増えない。
  */
  const intensity =
    plan.source === 'start' || plan.headline.includes(INTENSITY_LABEL[plan.intensity])
      ? ''
      : INTENSITY_LABEL[plan.intensity];
  const sub = [intensity, plan.summary].filter(Boolean).join('・');

  return (
    <Sheet label="今日やること" title="今日やること" onClose={onClose}>
      {/*
        見出しの置き場。**色の面にも、札にもしない。**
        面を敷けば、下に続く「なぜ」も「やること」も同じ強さで主張しはじめ、
        どれから読めばいいのか分からなくなる。いちばん大きい字が、いちばん先に読まれる。
      */}
      <div>
        <p className="t-title font-bold leading-snug">{plan.headline}</p>
        {sub && <p className="mt-1 t-note text-muted">{sub}</p>}
      </div>

      {/*
        今日の1足。**累計距離は出すのに、今日の判断まで運ぶアプリが無い。**
      */}
      {shoe?.shoe && (
        <div className="mt-3 rounded-[14px] bg-sunken px-3.5 py-3">
          <p className="t-note text-muted">今日の1足</p>
          <p className="mt-0.5 t-body font-bold">
            {shoe.shoe.name}
            <span className="ml-1.5 t-note font-normal text-muted tabular-nums">
              {Math.round(shoe.shoe.km)}km
            </span>
          </p>
          <p className="mt-1 t-note leading-relaxed text-muted">{shoe.why}</p>
          {shoe.caution && (
            <p className="mt-1.5 t-note leading-relaxed text-warn">{shoe.caution}</p>
          )}
          {shoe.suggestSecond && (
            <p className="mt-1.5 t-note leading-relaxed text-muted">{shoe.suggestSecond}</p>
          )}
        </div>
      )}

      {/*
        今日の空気。**走る前に言うから意味がある。**
        見出しのすぐ下に置く。手順の中に埋めると、出かける前に読まれない。
      */}
      {plan.weather && (
        <div
          className={[
            'mt-3 rounded-[14px] px-3.5 py-3',
            plan.weather.level === 'severe' ? 'bg-warn-soft' : 'bg-sunken',
          ].join(' ')}
        >
          <p
            className={`t-note font-bold ${plan.weather.level === 'severe' ? 'text-warn' : ''}`}
          >
            {plan.weather.headline}
          </p>
          <p className="mt-1 t-note leading-relaxed text-muted">{plan.weather.detail}</p>
        </div>
      )}

      {/* **理由を、手順より先に置く。** 納得していない手順は、途中で止まる。 */}
      <div className="mt-4">
        <p className="t-note font-bold">なぜ今日これなのか</p>
        <p className="mt-1 t-note leading-relaxed text-muted">{plan.why}</p>
      </div>

      <div className="mt-5">
        <p className="t-note font-bold">やること</p>
        <ol className="mt-2 space-y-2">
          {plan.steps.map((step, index) => (
            <li key={`${step.label}-${index}`} className="flex gap-2.5">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sunken t-note font-bold tabular-nums text-muted">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block t-note font-semibold">{step.label}</span>
                {step.detail && (
                  <span className="mt-0.5 block t-note leading-relaxed text-muted">
                    {step.detail}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/*
        **走れない日は、週の並びより先にこれ。**
        痛い人が見たいのは「今週どう組むか」ではなく「で、どうすればいいのか」。
      */}
      {comeback && <ComebackPanel plan={comeback} />}

      {/*
        **大会が近い人には、週の並びより先にこれ。**
        2週間前から出すのは、当日に初めて見ても練習で試せないため。
      */}
      {pacing && !comeback && <PacePlanPanel plan={pacing} />}

      {askLocation && onAllowLocation && <WeatherAsk onAllow={onAllowLocation} />}

      {week && !comeback && week.baseKm > 0 && (
        <div className="mt-6 border-t border-line pt-4">
          <WeekStrip
            plan={week}
            onPick={pickDay}
            selected={picked?.date ?? null}
            hint={moving ? '移す先の日を押してください' : undefined}
          />

          {picked && !moving && (
            <div className="mt-3 rounded-[14px] bg-sunken px-3.5 py-3">
              <p className="t-note font-bold">{describe(picked)}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setMoving(true)}
                  className="rounded-full bg-bg px-3.5 py-2 t-note font-semibold active:scale-[0.98]"
                >
                  別の日に移す
                </button>
                <button
                  type="button"
                  onClick={() =>
                    ask(`${describe(picked)}は、予定があって走れません。この週をどう組み替えますか。`)
                  }
                  className="rounded-full bg-bg px-3.5 py-2 t-note font-semibold active:scale-[0.98]"
                >
                  この日は走れない
                </button>
                <button
                  type="button"
                  onClick={() => ask(`${describe(picked)}の中身を変えたいです。`)}
                  className="rounded-full bg-bg px-3.5 py-2 t-note font-semibold active:scale-[0.98]"
                >
                  中身を変える
                </button>
              </div>
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="mt-2 t-note text-muted underline underline-offset-4"
              >
                やめる
              </button>
            </div>
          )}

          {moving && (
            <button
              type="button"
              onClick={() => setMoving(false)}
              className="mt-2 t-note text-muted underline underline-offset-4"
            >
              やめる
            </button>
          )}
        </div>
      )}

      {plan.alternatives.length > 0 && (
        <div className="mt-5">
          <p className="t-note font-bold">できない日のために</p>
          <ul className="mt-2 space-y-1.5">
            {plan.alternatives.map((alternative) => (
              <li
                key={alternative.when}
                className="rounded-[12px] bg-sunken px-3 py-2 t-note leading-relaxed"
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
        <p className="t-note font-bold">合わないときは、言ってください</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(plan.source === 'start'
            ? [
                { label: '記録の送り方は？', message: '走った記録は、どうやって送ればいいですか。' },
                { label: '目標を決めたい', message: '目標を決めたいです。何から決めればいいですか。' },
                { label: '脚が痛い', message: '脚に痛みがあります。どうすればいいですか。' },
              ]
            : [
                { label: '今日はきつい', message: '今日は体がきついです。メニューを変えられますか。' },
                { label: '時間がない', message: '今日は時間が取れません。短くできますか。' },
                { label: '脚が痛い', message: '脚に痛みがあります。どうすればいいですか。' },
                { label: 'もっとやりたい', message: 'もう少しやれそうです。増やしても大丈夫ですか。' },
              ]
          ).map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={() => ask(chip.message)}
              className="rounded-full bg-sunken px-3.5 py-2 t-note font-semibold active:scale-[0.98]"
            >
              {chip.label}
            </button>
          ))}
        </div>
        <p className="mt-2 t-note leading-relaxed text-muted">
          押すと、そのままコーチに相談できます。
          <strong className="font-semibold text-fg">決めたことは、その場で変えられます。</strong>
        </p>
      </div>
    </Sheet>
  );
}
