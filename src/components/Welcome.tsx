'use client';

import { useEffect, useRef, useState } from 'react';
import { COACH_CHARACTERS, charactersByLevel, levelInfo } from '@/lib/characters';
import CoachAvatar from './CoachAvatar';
import ConsentCheck from './ConsentCheck';

/**
 * いちばん最初の画面。
 *
 * **空のチャットに放り出さない。** 白紙の入力欄は、いちばん難しいUIで、
 * 「何を書けばいいのか」で止まった人は、たいてい二度と開かない。
 *
 * 最初にすることを「誰に見てもらうか選ぶ」にしたのは、
 *  - 8人の顔と口調は、このアプリでいちばん人を惹きつけるところで、
 *    それがカルテの奥に埋まっているのはもったいない
 *  - 選ぶこと自体が楽しい。**入力ではなく、選択から始める**
 *  - 選んだ相手が最初の一言を返すので、次に何が起きるかが分かる
 *
 * ここでは目標も心拍も聞かない。フォームを出した瞬間に半分が離れる。
 * 必要なことは、コーチが会話の中で数日かけて聞けばいい。
 */
export default function Welcome({
  onPick,
  busy = false,
}: {
  onPick: (characterId: string, displayName: string) => void;
  busy?: boolean;
}) {
  /** 選んでいる途中か、決まった人が出ている画面か。 */
  const [stage, setStage] = useState<'pick' | 'hello'>('pick');
  const [picked, setPicked] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const chosen = COACH_CHARACTERS.find((character) => character.id === picked);

  /**
   * 選んだら、その下に出たものまで送り届ける。
   *
   * **顔を選んだ時点で、紹介文も名前の欄も画面の外にある。**
   * 上のほうの顔を選んだ人には、下に何か出たことすら見えないまま
   * 決定ボタンに届いてしまい、名前を聞く機会がそこで消える。
   */
  const afterPick = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!picked) return;
    afterPick.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [picked]);

  /**
   * 決まった人が、中央に出てくる画面。
   *
   * **選んだ実感を、ここで作る。** 一覧の小さな顔のまま次の画面へ行くと、
   * 誰にお願いしたのかが自分の中で確定しない。
   * 中央で大きくなって、もうひとこと言う。それだけで「決めた」になる。
   */
  if (stage === 'hello' && chosen) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-6">
        <div className="animate-step-in flex flex-col items-center text-center">
          <CoachAvatar character={chosen} size={132} />
          <p className="mt-5 t-title font-bold">{chosen.name}</p>
          <p className="mt-1 t-note text-muted">{chosen.title}</p>
          <p className="mt-6 max-w-[20rem] t-body font-bold leading-relaxed text-accent">
            {chosen.welcome.chosen}
          </p>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => onPick(chosen.id, name.trim())}
          className="mt-10 w-full max-w-[20rem] rounded-full bg-accent py-3.5 t-body font-bold text-[var(--accent-fg)] disabled:opacity-40"
        >
          {busy ? '呼んでいます…' : 'はじめる'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <div className="scroll-area flex-1 overflow-y-auto px-4 pb-4 pt-8">
        {/*
          **名前を出す。** これまで、開いてもコーチの名前しか無く、
          いま自分が何を触っているのかを示すものが画面のどこにも無かった。
        */}
        <div className="mb-6 flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="" width={32} height={32} className="rounded-[9px]" />
          <span className="t-body font-bold tracking-[0.12em]">RUNCOACH</span>
        </div>

        {/*
          **「走るあなたに」で始めない。** まだ走っていない人は、その一語で
          自分向けではないと判断して閉じる。いちばん軽い入口（歩くところ）を
          先に置いて、いちばん重いところ（大会）まで幅があることを一行で見せる。
        */}
        <h1 className="t-title font-bold leading-snug">
          歩くところから、大会まで。
          <br />
          あなたに、専属のコーチを。
        </h1>
        <p className="mt-2.5 t-note leading-relaxed text-muted">
          これから走ってみようかな、という人も。目標タイムがある人も。
          記録を見て、その日その日で言葉をかけます。
          <strong className="font-semibold text-fg">
            痛みがある日は、誰を選んでも絶対に走らせません。
          </strong>
        </p>

        <h2 className="mt-7 t-body font-bold">まず、誰に見てもらいますか</h2>
        <p className="mt-1 t-note leading-relaxed text-muted">
          上の段ほど、求められることが軽いです。変わるのは話し方と求める量だけで、
          安全のルールは全員同じ。あとからいつでも変えられます。
        </p>

        {/*
          **難易度で段を分ける。** 8人の顔をただ並べると、いちばん上に出た人の
          一言で「自分向けか」が決まってしまう。「まず数字を見ます」の隣に
          走り始めたい人を立たせないために、段を先に見せて、軽いほうから並べる。
        */}
        <div className="mt-4 space-y-5">
          {charactersByLevel().map(({ level, characters }) => (
            <section key={level.id}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span
                  className="rounded-full px-2.5 py-0.5 t-note font-bold"
                  style={{ background: `${level.color}1f`, color: level.color }}
                >
                  {level.label}
                </span>
                <span className="t-note font-semibold text-fg">{level.demand}</span>
              </div>
              <p className="mt-1 t-note leading-relaxed text-muted">{level.who}</p>

              <ul className="mt-2.5 grid grid-cols-2 gap-2.5">
                {characters.map((character) => {
                  const active = picked === character.id;
                  return (
                    <li key={character.id}>
                      <button
                        type="button"
                        onClick={() => setPicked(character.id)}
                        aria-pressed={active}
                        className={[
                          'flex h-full w-full flex-col items-center gap-2 rounded-[16px] p-3 text-center transition active:scale-[0.98]',
                          active ? 'bg-accent-soft' : 'bg-sunken',
                        ].join(' ')}
                      >
                        {/*
                          押された顔が、ひと跳ねする。
                          **選んだ手ごたえが要る。** 枠の色が変わるだけでは、
                          押せたのかどうかが分かりにくい。
                        */}
                        <span key={active ? 'on' : 'off'} className={active ? 'animate-pop' : ''}>
                          <CoachAvatar character={character} size={64} />
                        </span>
                        <span className={`t-note font-bold ${active ? 'text-accent' : ''}`}>
                          {character.name}
                        </span>
                        {/* 顔の下は、肩書きではなく本人が言いそうな一言。 */}
                        <span className="t-note leading-snug text-muted">
                          {character.tagline}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        {chosen && (
          <div ref={afterPick}>
            {/*
              難易度をもう一度出す。選ぶと afterPick で下まで送るので、
              その時には上の段の見出しが画面の外にある。
            */}
            {/*
              **顔を押した瞬間に、その人の声が返ってくること。**
              名前と肩書きだけでは、誰を選ぶかは決められない。
              ひとこと聞ければ、合う合わないはすぐ分かる。
            */}
            <p
              key={chosen.id}
              className="animate-step-in mt-4 rounded-[16px] rounded-tl-[4px] bg-accent-soft px-4 py-3 t-body font-bold leading-relaxed text-accent"
            >
              {chosen.welcome.picked}
            </p>

            <div className="mt-3 rounded-[14px] bg-sunken px-3.5 py-3">
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 t-note">
                <span
                  className="rounded-full px-2 py-0.5 font-bold"
                  style={{
                    background: `${levelInfo(chosen.level).color}1f`,
                    color: levelInfo(chosen.level).color,
                  }}
                >
                  {levelInfo(chosen.level).label}
                </span>
                <span className="font-semibold text-fg">{levelInfo(chosen.level).demand}</span>
              </p>
              <p className="mt-2 t-note leading-relaxed text-muted">{chosen.description}</p>
            </div>

            {/*
              名前は、**選んだあとにだけ出す。**
              最初の画面に入力欄が見えていると、選ぶ前に「書かされる」画面になる。
              任意にしてあるが、ここで入れてもらえると初回の一言から名前で呼べる。
            */}
            <label className="mt-5 block">
              <span className="t-body font-bold">何と呼べばいいですか</span>
              <span className="mt-1 block t-note leading-relaxed text-muted">
                {chosen.speech.honorific
                  ? `${chosen.name}さんは「なまえ${chosen.speech.honorific}」と呼びかけます。`
                  : `${chosen.name}さんは呼び捨てで話します。`}
                あとから変えられます。
              </span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="ニックネームでも構いません"
                maxLength={20}
                className="mt-2 w-full rounded-xl border border-transparent bg-sunken px-3 py-2.5 text-fg outline-none focus:border-[color:var(--accent)]"
              />
            </label>
          </div>
        )}
      </div>

      {/* 選んでから決める。人を選ぶのだから、一拍おける形にしておく。 */}
      <div className="border-t border-line bg-bg px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        {/*
          **同意は、決定ボタンのすぐ上に置く。** 体の情報を預かる前に、必ず目に入る場所。
          スクロールの奥に置くと、読まずに押せてしまう。
        */}
        <div className="mb-3">
          <ConsentCheck checked={agreed} onChange={setAgreed} />
        </div>
        <button
          type="button"
          disabled={!picked || !agreed || busy}
          onClick={() => picked && setStage('hello')}
          className="w-full rounded-full bg-accent py-3.5 t-body font-bold text-[var(--accent-fg)] disabled:opacity-40"
        >
          {busy
            ? '呼んでいます…'
            : !chosen
              ? 'コーチを選んでください'
              : !agreed
                ? '同意すると始められます'
                : `${chosen.name}さんにお願いする`}
        </button>
      </div>
    </div>
  );
}
