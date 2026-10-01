'use client';

import type { RunnerProfile } from '@/lib/types';
import Sheet from './Sheet';
import { BarChart, LineChart } from './ReviewCharts';
import Outlook from './Outlook';
import {
  fourWeekComparison,
  hasHistory,
  monthlyVolume,
  paceLabel,
  painHistory,
  totals,
  weeklyPace,
  weightTrend,
} from '@/lib/review';
import { SHOE_ROLE_LABEL } from '@/lib/shoes';
import { describeRace, pastRaces } from '@/lib/races';

interface Props {
  profile: RunnerProfile | null;
  /** 記録がまだ無い時に出す、取り込みへの入口。 */
  onImport?: () => void;
  onClose: () => void;
  /** カレンダーの画面へ送る。 */
  onOpenCalendar?: () => void;
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line py-4 first:border-t-0 first:pt-0">
      <h3 className="text-[13px] font-bold">{title}</h3>
      {note && <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{note}</p>}
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

/** 積み上げの総量。大きい数字には等幅を使わない（間延びして見える）。 */
function Tile({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <div className="flex-1 rounded-[14px] bg-sunken px-3 py-2.5">
      <p className="whitespace-nowrap text-[22px] font-bold leading-none">
        {value}
        {unit && <span className="ml-0.5 text-[12px] font-semibold text-muted">{unit}</span>}
      </p>
      <p className="mt-1 text-[11px] text-muted">{label}</p>
    </div>
  );
}

/** ペースは小さいほど速い。％ではなく「何秒速いか」で言う。 */
function paceDelta(recent: number, previous: number): string | null {
  if (!recent || !previous) return null;
  const diff = Math.round(previous - recent);
  if (diff === 0) return '変わらず';
  return diff > 0 ? `${diff}秒/km 速くなった` : `${-diff}秒/km 遅くなった`;
}

export default function ReviewSheet({ profile, onImport, onOpenCalendar, onClose }: Props) {
  const now = new Date();
  const summary = profile ? totals(profile, now) : null;
  const months = profile ? monthlyVolume(profile, 6, now) : [];
  const pace = profile ? weeklyPace(profile, { now }) : [];
  const weight = profile ? weightTrend(profile, 90, now) : [];
  const comparison = profile ? fourWeekComparison(profile, now) : [];
  const pains = profile ? painHistory(profile, now) : [];
  const races = profile ? pastRaces(profile, now) : [];
  const shoes = profile?.shoes ?? [];
  const hasAnything = hasHistory(profile);

  return (
    <Sheet label="ふりかえり" title="ふりかえり" onClose={onClose}>
      {!hasAnything ? (
        /*
          **空の画面を、空のまま出さない。** 何も無いことだけ伝えても、
          次に何をすればここが埋まるのかが分からない。進む先を置く。
        */
        <div className="py-8 text-center">
          <p className="text-[13px] leading-relaxed text-muted">
            まだ記録がありません。
            <br />
            走った日のことを教えてもらえれば、ここに積み上がっていきます。
          </p>
          {onImport && (
            <>
              <button
                type="button"
                onClick={onImport}
                className="mt-4 rounded-full bg-accent px-5 py-2.5 text-[14px] font-bold text-[var(--accent-fg)]"
              >
                記録をまとめて取り込む
              </button>
              <p className="mt-2 text-[11px] leading-relaxed text-muted">
                過去の練習をまとめて入れると、いきなりここが埋まります。
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="pb-2">
          <Section
            title="ここまで積み上げたもの"
            note={summary?.since ? `${summary.since} から ${summary.days}日` : undefined}
          >
            <div className="flex gap-2">
              <Tile value={`${summary?.km ?? 0}`} unit="km" label="走った距離" />
              <Tile value={`${summary?.runs ?? 0}`} unit="回" label="走った回数" />
              <Tile value={`${summary?.hours ?? 0}`} unit="時間" label="動いた時間" />
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              記録のある日: {summary?.loggedDays ?? 0}日。
              この積み上げは、ほかのどこにも持っていけません。
            </p>
          </Section>

          {/*
            **先のことを、積み上げのすぐ下に置く。**
            過去のグラフは「やってきたこと」を見せるが、続ける理由にはなりにくい。
            「この調子なら目標に届く」が見えた時に、人は明日も走る。
          */}
          <Section title="このまま続けたら">
            <Outlook profile={profile} />
          </Section>

          {/*
            カレンダーは、頭の列から開く独立した画面にした。
            **ここで同じものをもう一度描かない。** 同じ絵が2か所にあると、
            どちらが本体なのか分からなくなるし、縦に長くなって他が埋もれる。
            ここには入口だけを置く。
          */}
          {onOpenCalendar && (
            <button
              type="button"
              onClick={onOpenCalendar}
              className="mb-4 flex w-full items-center gap-3 rounded-[14px] border border-line px-3.5 py-3 text-left active:scale-[0.99]"
            >
              <svg viewBox="0 0 24 24" className="h-[20px] w-[20px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="16" rx="3" />
                <path d="M3 10h18M8 3v4M16 3v4" />
                <circle cx="8.5" cy="14.5" r="1.1" fill="currentColor" stroke="none" />
                <circle cx="12" cy="14.5" r="1.1" fill="currentColor" stroke="none" />
                <circle cx="15.5" cy="18" r="1.1" fill="currentColor" stroke="none" />
              </svg>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-bold">カレンダーで見る</span>
                <span className="block text-[11px] leading-snug text-muted">
                  走った日と、空いた日。消費カロリーの目安も
                </span>
              </span>
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          )}

          <Section title="月ごとの走行距離">
            <BarChart
              bars={months.map((month) => ({ label: month.label, value: month.km }))}
              unit="km"
              ariaLabel={`月ごとの走行距離。${months.map((m) => `${m.label} ${m.km}km`).join('、')}`}
            />
            <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted tabular-nums">
              {months.map((month) => (
                <li key={month.month}>
                  {month.label} {month.km}km
                  {month.runs > 0 ? `・${month.runs}回` : ''}
                </li>
              ))}
            </ul>
          </Section>

          <Section title="直近4週と、その前の4週" note="週ごとの揺れに埋もれて、自分では見えないところ">
            <ul className="space-y-2">
              {comparison.map((row) => {
                const isPace = row.unit === '/km';
                const recent = isPace ? (row.recent ? `${paceLabel(row.recent)}/km` : '—') : `${row.recent}${row.unit}`;
                const previous = isPace
                  ? row.previous
                    ? `${paceLabel(row.previous)}/km`
                    : '—'
                  : `${row.previous}${row.unit}`;
                const delta = isPace
                  ? paceDelta(row.recent, row.previous)
                  : row.changePercent === undefined
                    ? null
                    : row.changePercent === 0
                      ? '変わらず'
                      : `${row.changePercent > 0 ? '+' : ''}${row.changePercent}%`;
                return (
                  <li key={row.label} className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px]">{row.label}</span>
                    <span className="text-[13px] tabular-nums">
                      <span className="font-semibold">{recent}</span>
                      <span className="mx-1.5 text-muted">←</span>
                      <span className="text-muted">{previous}</span>
                      {delta && <span className="ml-2 text-[12px] text-muted">{delta}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Section>

          {pace.length >= 2 && (
            <Section
              title="ペースの移り変わり"
              note="5km以上の練習を、週ごとにならした平均"
            >
              <LineChart
                points={pace.map((point) => ({
                  label: point.weekStart.slice(5).replace('-', '/'),
                  value: point.secondsPerKm,
                  display: `${paceLabel(point.secondsPerKm)}/km`,
                }))}
                ariaLabel="週ごとの平均ペースの移り変わり"
                invert
                axisNote="↑ 上ほど速い"
                formatTick={(seconds) => paceLabel(seconds)}
              />
            </Section>
          )}

          {weight.length >= 2 && (
            <Section title="体重" note="増えた減ったではなく、線が続いていることが値打ちです">
              <LineChart
                points={weight.map((point) => ({
                  label: point.date.slice(5).replace('-', '/'),
                  value: point.kg,
                  display: `${point.kg}kg`,
                }))}
                ariaLabel="はかった体重の移り変わり"
                formatTick={(kg) => String(Math.round(kg * 10) / 10)}
              />
            </Section>
          )}

          {shoes.length > 0 && (
            <Section title="履いてきた靴">
              <ul className="space-y-1.5">
                {shoes.map((shoe) => (
                  <li key={shoe.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className={shoe.retiredAt ? 'text-muted' : ''}>
                      {shoe.name}
                      <span className="ml-1.5 text-[11px] text-muted">{SHOE_ROLE_LABEL[shoe.role]}</span>
                      {shoe.retiredAt && <span className="ml-1.5 text-[11px] text-muted">引退</span>}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted">{Math.round(shoe.km)} km</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {pains.length > 0 && (
            <Section title="痛みの記録" note="止めた判断も、積み上げのうちです">
              <ul className="space-y-1.5">
                {pains.map((pain) => (
                  <li key={`${pain.site}-${pain.since ?? ''}`} className="text-[13px]">
                    <span className={pain.resolved ? 'text-good' : 'text-warn'}>
                      {pain.site}
                      {pain.resolved ? '（解消）' : '（継続中）'}
                    </span>
                    {pain.days !== undefined && (
                      <span className="ml-1.5 text-[12px] text-muted">
                        {pain.since} から {pain.days}日
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {races.length > 0 && (
            <Section title="走った大会">
              <ul className="space-y-1.5">
                {races.map((race) => (
                  <li key={race.id} className="text-[13px] leading-relaxed">
                    {describeRace(race, now)}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </Sheet>
  );
}
