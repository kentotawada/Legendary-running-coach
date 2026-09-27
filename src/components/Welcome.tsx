'use client';

import { useState } from 'react';
import { COACH_CHARACTERS } from '@/lib/characters';
import CoachAvatar from './CoachAvatar';

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
  onPick: (characterId: string) => void;
  busy?: boolean;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const chosen = COACH_CHARACTERS.find((character) => character.id === picked);

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <div className="scroll-area flex-1 overflow-y-auto px-4 pb-4 pt-8">
        <h1 className="text-[22px] font-bold leading-snug">
          走るあなたに、
          <br />
          専属のコーチを。
        </h1>
        <p className="mt-2.5 text-[13px] leading-relaxed text-muted">
          練習の記録を見て、その日その日で言葉をかけます。
          <strong className="font-semibold text-fg">
            痛みがある日は、誰を選んでも絶対に走らせません。
          </strong>
        </p>

        <h2 className="mt-7 text-[15px] font-bold">まず、誰に見てもらいますか</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          変わるのは話し方だけです。指導の中身と安全のルールは同じ。あとからいつでも変えられます。
        </p>

        <ul className="mt-3 grid grid-cols-2 gap-2.5">
          {COACH_CHARACTERS.map((character) => {
            const active = picked === character.id;
            return (
              <li key={character.id}>
                <button
                  type="button"
                  onClick={() => setPicked(character.id)}
                  aria-pressed={active}
                  className={[
                    'flex h-full w-full flex-col items-center gap-2 rounded-[16px] border p-3 text-center transition active:scale-[0.98]',
                    active ? 'border-[color:var(--accent)] bg-accent-soft' : 'border-line bg-bg',
                  ].join(' ')}
                >
                  <CoachAvatar character={character} size={64} />
                  <span className={`text-[13px] font-bold ${active ? 'text-accent' : ''}`}>
                    {character.name}
                  </span>
                  {/* 顔の下は、肩書きではなく本人が言いそうな一言。 */}
                  <span className="text-[11px] leading-snug text-muted">{character.tagline}</span>
                </button>
              </li>
            );
          })}
        </ul>

        {chosen && (
          <p className="mt-4 rounded-[14px] bg-sunken px-3.5 py-3 text-[12px] leading-relaxed text-muted">
            {chosen.description}
          </p>
        )}
      </div>

      {/* 選んでから決める。人を選ぶのだから、一拍おける形にしておく。 */}
      <div className="border-t border-line bg-bg px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <button
          type="button"
          disabled={!picked || busy}
          onClick={() => picked && onPick(picked)}
          className="w-full rounded-full bg-accent py-3.5 text-[15px] font-bold text-[var(--accent-fg)] disabled:opacity-40"
        >
          {busy
            ? '呼んでいます…'
            : chosen
              ? `${chosen.name}さんにお願いする`
              : 'コーチを選んでください'}
        </button>
      </div>
    </div>
  );
}
