'use client';

import { useState } from 'react';
import type { PaceMix } from '@/lib/mix';

/**
 * 練習の形が偏っている人に、一度だけ知らせる帯。
 *
 * **これを、ふりかえりの奥だけに置いてはいけない。**
 * 乗り換えてきた人は、初日にふりかえりまで開かない。
 * けれどここは、他のアプリを何年使っても一度も言われないことで、
 * **「このアプリは自分の走りを本当に見ている」と分かる唯一の瞬間**になる。
 * 言う場所を間違えると、そのまま気づかれずに終わる。
 *
 * 同じことを毎日言えば、ただの小言になる。**閉じたら、もう出さない。**
 */
const KEY = 'coach.mix.dismissed';

/** 一度閉じたか。**閉じたものは二度と出さない。** */
function wasDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    // 保存が使えない環境でも、案内そのものは出してよい。
    return false;
  }
}

export default function MixBanner({ mix, onOpen }: { mix: PaceMix; onOpen: () => void }) {
  /*
    描画の時点で読む。

    **この帯は、サーバーからの返事が届いたあとにしか現れない**ので、
    サーバー側の描画と食い違う心配がない（親が live の時だけ描いている）。
    効果の中で読むと、一度出してから消す形になり、
    閉じたはずの帯が開くたびに一瞬ちらつく。
  */
  const [dismissed, setDismissed] = useState(wasDismissed);
  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // 覚えられない環境でも、その場で消えることは変わらない。
    }
  };

  return (
    <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="block t-note font-semibold leading-tight">{mix.headline}</span>
        {/*
          **根拠は、1行に収まる長さまで。**
          帯で全部を説明しきろうとすると、会話がそのぶん画面の外へ出る。
          詳しくは「見る」の先にある。
        */}
        <span className="mt-0.5 block t-note leading-tight text-muted tabular-nums">
          {mix.runs}本中 ゆっくり{mix.bands[0].percent}%・中{mix.bands[1].percent}%・速い
          {mix.bands[2].percent}%
        </span>
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="shrink-0 px-1 t-note font-bold text-accent"
      >
        見る
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="この案内を閉じる"
        className="-mr-1 shrink-0 px-1 t-body leading-none text-muted"
      >
        ×
      </button>
    </div>
  );
}
