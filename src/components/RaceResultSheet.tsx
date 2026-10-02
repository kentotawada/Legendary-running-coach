'use client';

import { useState } from 'react';
import Sheet from './Sheet';
import type { RaceEntry, RunnerProfile } from '@/lib/types';
import { raceDistanceKm } from '@/lib/gear-spec';
import { formatPace } from '@/lib/goals';
import {
  distanceLabel,
  fadeOf,
  isPersonalBest,
  raceTime,
  segmentsOf,
} from '@/lib/race-result';
import { SHARE_FILE_NAME, raceCardContent, renderShareCard } from '@/lib/share-card';

/**
 * 大会1本の中身。
 *
 * **記録証に載っているものを、読める形に置き直す。**
 * 記録証は累積の通過しか書いていないので、「どこで落ちたか」は
 * 自分で引き算しないと分からない。そこをやる。
 */
export default function RaceResultSheet({
  race,
  profile,
  now,
  onClose,
  onBack,
  onAsk,
}: {
  race: RaceEntry;
  profile: RunnerProfile | null;
  now: Date;
  onClose: () => void;
  onBack?: () => void;
  onAsk: (message: string) => void;
}) {
  const result = race.result;
  const km = raceDistanceKm(race);
  const segments = result ? segmentsOf(result, km) : [];
  const fade = result ? fadeOf(result, km) : null;
  const best = isPersonalBest(race, profile, now);
  const avgPaceSec = result && km ? result.finishSec / km : undefined;

  const [sharing, setSharing] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);

  /**
   * 1枚にして渡す。
   * **載せるのは大会名・距離・タイムと通過の形だけ。**
   * 順位もゼッケンも体のことも入れない。画面を撮ると全部写る、を避けるための絵。
   */
  const share = async () => {
    if (!result || sharing) return;
    setSharing(true);
    setShareNote(null);
    try {
      const blob = await renderShareCard(
        raceCardContent({
          name: race.name,
          distanceLabel: km ? distanceLabel(km) : '完走',
          finishTime: raceTime(result.finishSec),
          avgPace: avgPaceSec ? formatPace(avgPaceSec) : undefined,
          segmentPaces: segments.map((segment) => ({
            label: `${Math.round(segment.toKm)}km`,
            paceSec: segment.paceSec,
          })),
          fadePercent: fade?.percent,
          personalBest: best,
        }),
      );
      if (!blob) throw new Error('画像を作れませんでした');
      const file = new File([blob], SHARE_FILE_NAME, { type: 'image/png' });

      if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = SHARE_FILE_NAME;
      link.click();
      URL.revokeObjectURL(url);
      setShareNote('画像を保存しました。');
    } catch (error) {
      // 共有シートを閉じただけの時もここに来る。それは失敗ではない。
      if ((error as Error)?.name === 'AbortError') return;
      setShareNote('画像を作れませんでした。');
    } finally {
      setSharing(false);
    }
  };

  if (!result) return null;

  /*
    棒の長さ。

    **0 から引くと、差が見えない。**
    フルの区間ペースは速くても遅くても 4:54〜5:17 くらいの幅しかなく、
    0起点だと棒の長さが 7% しか違わない。全部同じ長さに見えて、
    「どこで落ちたか」という、この表のただ一つの用事が果たせない。

    いちばん速い区間を土台の長さに置いて、そこからの差を残りで伸ばす。
    垂れた区間が、ひと目で分かるようになる。
  */
  const slowest = segments.reduce((max, segment) => Math.max(max, segment.paceSec), 0);
  const fastest = segments.reduce((min, segment) => Math.min(min, segment.paceSec), Infinity);
  const BASE_WIDTH = 34;
  const barWidth = (paceSec: number) => {
    if (!(slowest > fastest)) return 100;
    return BASE_WIDTH + (100 - BASE_WIDTH) * ((paceSec - fastest) / (slowest - fastest));
  };

  return (
    <Sheet
      label={race.name}
      title={race.name}
      onClose={onClose}
      onBack={onBack}
      backLabel={onBack ? 'ふりかえり' : undefined}
    >
      <div
        className={[
          'rounded-[16px] border px-4 py-3.5',
          best ? 'border-[color:var(--accent)] bg-accent-soft' : 'border-line bg-sunken',
        ].join(' ')}
      >
        <p className="flex items-center gap-2 text-[11px]">
          <span className="rounded-full bg-bg px-2 py-0.5 font-bold text-muted">
            {km ? distanceLabel(km) : '完走'}
          </span>
          <span className="text-muted">{race.date}</span>
          {best && (
            <span className="rounded-full bg-accent px-2 py-0.5 font-bold text-[var(--accent-fg)]">
              自己ベスト
            </span>
          )}
        </p>
        <p className={`mt-1.5 text-[32px] font-bold leading-none tabular-nums ${best ? 'text-accent' : ''}`}>
          {raceTime(result.finishSec)}
        </p>
        <p className="mt-1.5 text-[12px] text-muted tabular-nums">
          {avgPaceSec ? `1kmあたり ${formatPace(avgPaceSec)}` : ''}
          {result.timing === 'net' ? ' ・ ネットタイム' : result.timing === 'gross' ? ' ・ グロスタイム' : ''}
        </p>
      </div>

      {/*
        後半の落ち率。**市民ランナーの大会は、ほぼ全部ここで決まる。**
        突っ込んで入って、30kmから落ちる。落ちた幅が全部タイムになる。
      */}
      {fade && (
        <div className="mt-3 rounded-[14px] bg-sunken px-3.5 py-3">
          <div className="flex items-baseline justify-between">
            <p className="text-[13px] font-bold">
              {fade.negative ? '後半のほうが速い' : '後半の落ち'}
            </p>
            <p
              className={`text-[18px] font-bold tabular-nums ${fade.negative ? 'text-accent' : ''}`}
            >
              {fade.percent > 0 ? '+' : ''}
              {fade.percent}%
            </p>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-muted tabular-nums">
            前半 {formatPace(fade.firstHalfPaceSec)} → 後半 {formatPace(fade.secondHalfPaceSec)}
            （1kmあたり {fade.deltaSec > 0 ? '+' : ''}
            {fade.deltaSec}秒）
          </p>
        </div>
      )}

      {/* 区間ごとの通過。**累積のままでは、どこで落ちたか読めない。** */}
      {segments.length > 1 && (
        <div className="mt-5">
          <p className="text-[13px] font-bold">区間ごとのペース</p>
          <ul className="mt-2 space-y-1.5">
            {segments.map((segment) => (
              <li key={segment.toKm} className="flex items-center gap-2">
                <span className="w-[52px] shrink-0 text-[11px] text-muted tabular-nums">
                  {Math.round(segment.fromKm)}–{Math.round(segment.toKm)}
                </span>
                <span className="h-5 min-w-0 flex-1 overflow-hidden rounded-[4px] bg-bg">
                  <span
                    className="block h-full rounded-[4px] bg-accent"
                    style={{ width: `${barWidth(segment.paceSec)}%` }}
                  />
                </span>
                <span className="w-[62px] shrink-0 text-right text-[11px] font-semibold tabular-nums">
                  {formatPace(segment.paceSec)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            棒が長いほど、その区間は遅く走っています。いちばん速い区間を基準にした長さです。
          </p>
        </div>
      )}

      {(result.placing?.overall || result.placing?.categoryPlace || result.weather?.tempC !== undefined) && (
        <div className="mt-5 flex flex-wrap gap-2">
          {result.placing?.overall !== undefined && (
            <Fact
              label="総合"
              value={`${result.placing.overall.toLocaleString()}位`}
              note={result.placing.finishers ? `${result.placing.finishers.toLocaleString()}人中` : undefined}
            />
          )}
          {result.placing?.categoryPlace !== undefined && (
            <Fact
              label={result.placing.category ?? '年代別'}
              value={`${result.placing.categoryPlace.toLocaleString()}位`}
            />
          )}
          {/* **印字されていた時だけ出す。** 推測の気温は、翌年の判断を狂わせる。 */}
          {result.weather?.tempC !== undefined && (
            <Fact label="当日の気温" value={`${result.weather.tempC}℃`} />
          )}
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void share()}
          disabled={sharing}
          className="rounded-full bg-accent px-4 py-2.5 text-[13px] font-bold text-[var(--accent-fg)] active:scale-[0.98] disabled:opacity-40"
        >
          {sharing ? '作っています…' : '画像にして渡す'}
        </button>
        <button
          type="button"
          onClick={() => {
            onClose();
            onAsk(
              `${race.date}の${race.name}（${raceTime(result.finishSec)}）について、この走りをどう見ますか。` +
                (fade ? `後半は前半より ${fade.percent}% ${fade.negative ? '速い' : '遅い'}です。` : ''),
            );
          }}
          className="rounded-full border border-line px-4 py-2.5 text-[13px] font-semibold active:scale-[0.98]"
        >
          コーチに見てもらう
        </button>
      </div>
      {shareNote && <p className="mt-2 text-[12px] text-muted">{shareNote}</p>}
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        画像に入るのは、大会名・距離・タイムと区間の形だけです。順位もゼッケンも入りません。
      </p>
    </Sheet>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-[12px] bg-sunken px-3 py-2">
      <p className="text-[10px] text-muted">{label}</p>
      <p className="text-[15px] font-bold leading-tight tabular-nums">{value}</p>
      {note && <p className="text-[10px] text-muted tabular-nums">{note}</p>}
    </div>
  );
}
