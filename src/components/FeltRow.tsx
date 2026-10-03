'use client';

import { useState } from 'react';
import type { ActivityLog } from '@/lib/types';

/**
 * 走った直後の「どうだった？」を、押すだけで残す。
 *
 * **時計が絶対に取れない、唯一のデータ。**
 * 同じ 5:30/km・心拍148 でも、「余裕だった」のか「必死だった」のかで、
 * 意味は正反対になる。睡眠・気温・仕事の疲れは、そこにしか出ない。
 *
 * 文章で聞けば、ほとんどの人は書かない。**3つから選ぶだけ**にする。
 * 選んだあとは何も聞かない。お礼も要らない。手応えが1つ増えただけ。
 */

/** 主観的運動強度（1〜10）への割り当て。走った後に選べる粒度は、このくらいが限界。 */
const CHOICES = [
  { label: '余裕', effort: 3, hint: '会話できた' },
  { label: 'ちょうどいい', effort: 5, hint: '少しきつい' },
  { label: 'きつかった', effort: 8, hint: '話せない' },
] as const;

export default function FeltRow({
  activity,
  onPick,
}: {
  activity: ActivityLog;
  onPick: (effort: number) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);

  const choose = (effort: number) => {
    setPicked(effort);
    onPick(effort);
  };

  if (picked !== null) {
    return (
      <div className="border-t border-line px-4 py-2 t-note text-muted">
        ありがとうございます。次の比較に使います。
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 border-t border-line px-4 py-2">
      <span className="shrink-0 t-note text-muted">
        {activity.distanceKm ? `${activity.distanceKm}km、` : ''}どうでした？
      </span>
      <div className="flex min-w-0 flex-1 justify-end gap-1.5">
        {CHOICES.map((choice) => (
          <button
            key={choice.label}
            type="button"
            onClick={() => choose(choice.effort)}
            title={choice.hint}
            className="rounded-full bg-sunken px-2.5 py-1 t-note font-semibold active:scale-[0.97]"
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}
