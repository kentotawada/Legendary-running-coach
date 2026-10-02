'use client';

import type { PaceMix } from '@/lib/mix';
import { WINDOW_DAYS } from '@/lib/mix';
import { formatPace } from '@/lib/goals';

/**
 * 練習の強弱の、形。
 *
 * **1本ずつ見ていても、絶対に気づけないもの。**
 * どの練習も単体では悪くないので、並べて初めて偏りが見える。
 */
const COLOR: Record<string, string> = {
  easy: 'var(--accent)',
  grey: 'color-mix(in srgb, var(--accent) 45%, transparent)',
  hard: 'color-mix(in srgb, var(--accent) 20%, transparent)',
};

export default function MixCard({ mix, onAsk }: { mix: PaceMix; onAsk?: (message: string) => void }) {
  // 偏っている時だけ、見出しを立てる。分かれている人を驚かせない。
  const alert = mix.verdict === 'grey' || mix.verdict === 'no-easy';

  return (
    <div
      className={[
        'rounded-[16px] border px-4 py-3.5',
        alert ? 'border-[color:var(--accent)] bg-accent-soft' : 'border-line bg-sunken',
      ].join(' ')}
    >
      <p className={`text-[15px] font-bold leading-snug ${alert ? 'text-accent' : ''}`}>
        {mix.headline}
      </p>

      {/* 帯。**割合は、棒の長さで見せる。** 数字の行では形が見えない。 */}
      <div className="mt-2.5 flex h-7 w-full overflow-hidden rounded-[6px] bg-bg">
        {mix.bands
          .filter((band) => band.percent > 0)
          .map((band) => (
            <div
              key={band.band}
              className="flex items-center justify-center text-[10px] font-bold tabular-nums"
              style={{
                width: `${band.percent}%`,
                background: COLOR[band.band],
                color: band.band === 'easy' ? 'var(--accent-fg)' : 'var(--fg)',
              }}
            >
              {band.percent >= 12 ? `${band.percent}%` : ''}
            </div>
          ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
        {mix.bands.map((band) => (
          <span key={band.band} className="flex items-center gap-1 text-[11px] text-muted">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: COLOR[band.band] }}
            />
            {band.label} {band.percent}%
          </span>
        ))}
      </div>

      <p className="mt-2.5 text-[12px] leading-relaxed text-muted">{mix.detail}</p>

      {mix.next && (
        <p className="mt-2.5 rounded-[10px] bg-bg px-3 py-2 text-[12px] leading-relaxed">
          <strong className="font-bold">変えるなら、ひとつだけ。</strong> {mix.next}
        </p>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-muted tabular-nums">
        直近{WINDOW_DAYS}日 {mix.runs}本 / {mix.km}km ・ {formatPace(mix.easyFromSec)} より遅ければ「ゆっくり」、
        {formatPace(mix.thresholdSec)} より速ければ「速い」
        {mix.anchorFrom === 'performance' && mix.anchorRun
          ? `（${mix.anchorRun.date} の ${mix.anchorRun.km}km ${mix.anchorRun.pace} を基準にしています）`
          : '（まだ力を測れる記録が無いので、目標から置いた目安です）'}
      </p>

      {onAsk && mix.next && (
        <button
          type="button"
          onClick={() =>
            onAsk(
              `練習の強弱が「${mix.headline}」と出ています。` +
                `ゆっくり${mix.bands[0].percent}% / 中くらい${mix.bands[1].percent}% / 速い${mix.bands[2].percent}%です。` +
                'どう直せばいいですか。',
            )
          }
          className="mt-3 rounded-full border border-line bg-bg px-4 py-2 text-[13px] font-semibold active:scale-[0.98]"
        >
          どう直すか相談する
        </button>
      )}
    </div>
  );
}
