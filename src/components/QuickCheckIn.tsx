'use client';

/**
 * 言い出しにくいことほど、ワンタップで言えるようにしておく。
 * 対象はサブ3を狙うランナーなので、内容も練習報告と体の異変に寄せている。
 */
type Chip =
  | { label: string; kind: 'message'; message: string; tone?: 'warn' }
  | { label: string; kind: 'image'; tone?: 'accent' }
  | { label: string; kind: 'ideas'; tone?: 'accent' };

const CHIPS: Chip[] = [
  { label: '💡 何を相談する？', kind: 'ideas' },
  { label: '📊 練習データを送る', kind: 'image', tone: 'accent' },
  { label: '🔥 ポイント練習の報告', kind: 'message', message: '今日のポイント練習について報告します。' },
  { label: '🦵 膝・足の違和感', kind: 'message', message: '膝（または足）に違和感があります。', tone: 'warn' },
  { label: '😮‍💨 疲労が抜けない', kind: 'message', message: '疲労が抜けません。脚が重い状態が続いています。' },
  { label: '📅 今週の組み立て', kind: 'message', message: '今週の練習の組み立てを相談させてください。' },
  { label: '⏳ 時間が取れない', kind: 'message', message: '今日は練習の時間がほとんど取れません。' },
];

interface Props {
  onPick: (message: string) => void;
  onPickImage: () => void;
  onOpenIdeas: () => void;
  disabled?: boolean;
}

const TONE_CLASS: Record<string, string> = {
  warn: 'border-[color:var(--warn)] bg-warn-soft text-warn',
  accent: 'border-[color:var(--accent)] bg-accent-soft text-accent',
};

export default function QuickCheckIn({ onPick, onPickImage, onOpenIdeas, disabled = false }: Props) {
  const handle = (chip: Chip) => {
    if (chip.kind === 'image') return onPickImage();
    if (chip.kind === 'ideas') return onOpenIdeas();
    return onPick(chip.message);
  };

  return (
    <div className="scroll-area flex gap-2 overflow-x-auto px-4 pb-2 pt-3">
      {CHIPS.map((chip) => (
        <button
          key={chip.label}
          type="button"
          disabled={disabled && chip.kind !== 'ideas'}
          onClick={() => handle(chip)}
          className={[
            'shrink-0 rounded-full border px-3.5 py-2 text-[13px] font-medium transition',
            'active:scale-[0.97] disabled:opacity-40',
            chip.tone ? TONE_CLASS[chip.tone] : 'border-line bg-elevated text-fg',
          ].join(' ')}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}
