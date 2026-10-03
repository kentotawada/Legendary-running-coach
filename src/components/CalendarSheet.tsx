'use client';

import MonthCalendar from './MonthCalendar';
import Sheet from './Sheet';
import type { RunnerProfile } from '@/lib/types';

/**
 * カレンダーだけの画面。
 *
 * **最初はふりかえりの中に置いていたが、探して見つからなかった。**
 * 見つからない機能は、無いのと同じ。開く場所を1つに決めて、
 * 頭の列からひと押しで届くようにした。
 */
export default function CalendarSheet({
  profile,
  onClose,
  onBack,
  backLabel,
}: {
  profile: RunnerProfile | null;
  onClose: () => void;
  onBack?: () => void;
  backLabel?: string;
}) {
  return (
    <Sheet label="カレンダー" title="カレンダー" onClose={onClose} onBack={onBack} backLabel={backLabel}>
      <p className="mb-4 t-note leading-relaxed text-muted">
        押すと、その日の中身が出ます。
        <br />
        <strong className="font-semibold text-fg">空いた日は、空いたまま。</strong>
        責めるための画面ではありません。
      </p>
      <MonthCalendar profile={profile} />
    </Sheet>
  );
}
