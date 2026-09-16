'use client';

/**
 * 「言い出しにくいこと」ほどワンタップで言えるようにする。
 * 忙しい・疲れた・痛い を、罪悪感なく押せる位置に置いておくのが狙い。
 */
const CHIPS: { label: string; message: string; tone?: 'warn' }[] = [
  { label: '🦵 痛みがある', message: '体に痛みや違和感があります。', tone: 'warn' },
  { label: '⏳ 今日は時間がない', message: '今日は忙しくて、走る時間がほとんど取れません。' },
  { label: '😮‍💨 疲れている', message: '疲れが残っていて、モチベーションが上がりません。' },
  { label: '🏃 走ってきた', message: '走ってきました！' },
  { label: '📋 今日どうする？', message: '今日は何をするのがいいですか？' },
];

interface Props {
  onPick: (message: string) => void;
  disabled?: boolean;
}

export default function QuickCheckIn({ onPick, disabled = false }: Props) {
  return (
    <div className="scroll-area flex gap-2 overflow-x-auto px-4 pb-2 pt-3">
      {CHIPS.map((chip) => (
        <button
          key={chip.label}
          type="button"
          disabled={disabled}
          onClick={() => onPick(chip.message)}
          className={[
            'shrink-0 rounded-full border px-3.5 py-2 text-[13px] font-medium transition',
            'active:scale-[0.97] disabled:opacity-40',
            chip.tone === 'warn'
              ? 'border-[color:var(--warn)] bg-warn-soft text-warn'
              : 'border-line bg-elevated text-fg',
          ].join(' ')}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}
