'use client';

import Trouble from '@/components/Trouble';

/**
 * 画面の描画で落ちた時。
 *
 * **これが無いと、Next.js の既定の「Application error」だけが出る。**
 * 英語1行の画面を見せられた人は、記録ごと消えたと受け取る。
 * ベータでいちばん高くつく見え方なので、必ず受け皿を置く。
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Trouble
      title="うまく開けませんでした"
      lead="一時的なものかもしれません。もう一度開くと、たいてい直ります。通信が不安定な場所では、電波の良いところで試してみてください。"
      error={error}
      source="error-boundary"
      onRetry={reset}
    />
  );
}
