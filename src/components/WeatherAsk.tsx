'use client';

import { useState } from 'react';

/**
 * 場所を一度だけ聞く。
 *
 * **理由を先に言う。** 位置情報の確認が、理由なしに突然出るのがいちばん嫌われる。
 * 聞く前に「何に使うか」「どこまで持つか」を書いておく。
 *
 * 持つのは**小数2桁（約1km四方）まで。** 天気を引くのに要るのはそこまでで、
 * それ以上は、ただ家の場所を預かることになる。
 */
export default function WeatherAsk({ onAllow }: { onAllow: (lat: number, lon: number) => void }) {
  const [asking, setAsking] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [failed, setFailed] = useState(false);

  if (hidden) return null;

  const ask = () => {
    setAsking(true);
    setFailed(false);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setAsking(false);
      setFailed(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setAsking(false);
        setHidden(true);
        onAllow(position.coords.latitude, position.coords.longitude);
      },
      () => {
        // 断られただけ。**もう出さない。** 二度目を出すのは、ただのしつこさ。
        setAsking(false);
        setHidden(true);
      },
      { timeout: 10_000, maximumAge: 600_000 },
    );
  };

  return (
    <div className="mt-6 rounded-[14px] bg-sunken px-3.5 py-3">
      <p className="t-note font-bold">暑さのぶん、ペースを調整しますか</p>
      <p className="mt-1 t-note leading-relaxed text-muted">
        夏は、同じ心拍でも同じ速度は出ません。それを知らずに目標ペースで入ると、後半で潰れます。
        <strong className="font-semibold text-fg">走る前に「今日は何秒落とすか」</strong>を出せます。
      </p>
      <p className="mt-1.5 t-note leading-relaxed text-muted">
        使うのは天気を引くためだけ。<strong className="font-semibold text-fg">約1km四方まで</strong>に
        丸めて持ちます。番地は持ちません。
      </p>
      <button
        type="button"
        onClick={ask}
        disabled={asking}
        className="mt-2.5 rounded-full bg-accent px-4 py-2 t-note font-bold text-[var(--accent-fg)] disabled:opacity-50"
      >
        {asking ? '確かめています…' : '場所を許可する'}
      </button>
      <button
        type="button"
        onClick={() => setHidden(true)}
        className="ml-3 t-note text-muted underline underline-offset-4"
      >
        いまはしない
      </button>
      {failed && (
        <p className="mt-2 t-note text-muted">
          この端末では場所を取れませんでした。暑さの調整は使えませんが、他は変わりません。
        </p>
      )}
    </div>
  );
}
