import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import {
  dayRow,
  keysForDay,
  pricesFromEnv,
  recentDays,
  retentionOf,
  totalsOf,
  USD_TO_JPY,
  type DayRow,
} from '@/lib/admin';
import { modelName, visionModelName } from '@/lib/models';
import { getOps, type OpsEvent } from '@/lib/ops';
import { adminEmails } from '@/lib/quota';
import { createSupabaseServerClient } from '@/lib/supabase';

export const metadata: Metadata = {
  title: '運営 | RUNCOACH',
  // 検索に載せない。持ち主だけが開く画面。
  robots: { index: false, follow: false },
};

/** 何日ぶん並べるか。 */
const DAYS = 14;

/**
 * 持ち主かどうか。**違えば「無い」ことにする**（403 ではなく 404）。
 * 管理の画面があること自体を、外に知らせない。
 * データベースを使っていない手元の開発でだけ、誰でも開ける。
 */
async function isOwner(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return process.env.NODE_ENV === 'development';
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email?.trim().toLowerCase();
  return Boolean(email && adminEmails().includes(email));
}

const number = (value: number) => value.toLocaleString('ja-JP');
const yen = (value: number | null) =>
  value === null ? '—' : value < 10 ? `¥${value.toFixed(1)}` : `¥${Math.round(value).toLocaleString('ja-JP')}`;
const time = (iso: string) =>
  new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

export default async function AdminPage() {
  /**
   * **毎回その場で作る。** これが無いと、データベースの設定が無いままビルドした時に
   * 1回だけ作って固定され、数が永久に更新されない（持ち主の判定も素通りになる）。
   */
  await connection();
  if (!(await isOwner())) notFound();

  const ops = getOps();
  const prices = pricesFromEnv();
  const days = recentDays(DAYS);

  // 読めなかったものは、読めなかったと画面に出す。**黙って 0 を並べない。**
  let rows: DayRow[] = [];
  let countsError: string | null = null;
  try {
    const counts = await ops.counts(days.flatMap(keysForDay));
    rows = days.map((day) => dayRow(day, counts, prices));
  } catch (error) {
    countsError = error instanceof Error ? error.message : String(error);
  }
  const totals = totalsOf(rows);
  const retention = retentionOf(rows);

  const read = async (kind: 'error' | 'feedback', limit: number) => {
    try {
      return { items: await ops.recent(kind, limit), error: null };
    } catch (error) {
      return { items: [] as OpsEvent[], error: error instanceof Error ? error.message : String(error) };
    }
  };
  const [errors, feedback] = await Promise.all([read('error', 20), read('feedback', 30)]);

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <div className="mx-auto max-w-[960px] px-4 pb-16 pt-6">
        <p className="text-[13px] font-bold tracking-[0.12em] text-muted">RUNCOACH</p>
        <h1 className="mt-1 text-[22px] font-bold">運営</h1>
        <p className="mt-1 text-[12px] text-muted">直近{DAYS}日。1日の区切りはアプリと同じ深夜2時。</p>

        {countsError && (
          <Notice>
            数を読めませんでした（{countsError}）。Supabase の SQL Editor で supabase/schema.sql
            の「4. 使った回数」を実行してください。
          </Notice>
        )}
        {!prices && (
          <Notice tone="muted">
            費用はまだ出していません。Vercel の環境変数 GEMINI_PRICE_PER_MTOK に、使っているモデルの単価（100万トークンあたりの米ドル）を
            「送る,書く」の順で入れると、円で出します（例: 2,12）。
          </Notice>
        )}

        <section className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="使い始めた人" value={number(totals.signups)} />
          <Stat
            label="話した回数"
            value={number(totals.turns)}
            note={
              totals.callsPerTurn !== null
                ? `1通につきモデルを ${totals.callsPerTurn.toFixed(1)} 回`
                : undefined
            }
          />
          <Stat
            label="概算の費用"
            value={yen(totals.yen)}
            note={[
              totals.yenPerTurn !== null ? `1回あたり ${yen(totals.yenPerTurn)}` : null,
              totals.cachedRatio !== null && totals.cachedRatio > 0
                ? `送った量の ${Math.round(totals.cachedRatio * 100)}% は使い回し`
                : null,
            ]
              .filter(Boolean)
              .join(' / ')}
          />
          <Stat
            label="上限に当たった"
            value={number(totals.limitGuest + totals.limitMember + totals.limitPremium)}
            note={`ゲスト ${number(totals.limitGuest)} / 会員 ${number(totals.limitMember)} / 有料 ${number(totals.limitPremium)}`}
          />
          <Stat
            label="有料になった人"
            value={number(totals.subscribed)}
            note={totals.unsubscribed > 0 ? `やめた人 ${number(totals.unsubscribed)}` : undefined}
          />
        </section>

        <section className="mt-8">
          <h2 className="text-[15px] font-bold">続いているか（直近7日）</h2>
          <p className="mt-1 text-[12px] text-muted">
            <strong>初日の人数ではなく、3日目・7日目に何人残ったかが答え。</strong>
            20人来て3日目に2人なら、それが答え。3人でも1週間続けば、それは本物。
          </p>
          <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Stat label="いちばん多かった日" value={`${number(retention.peakUsers)}人`} />
            <Stat
              label="誰かが話した日"
              value={`${number(retention.daysWithUse)} / 7日`}
              note={retention.daysWithUse >= 5 ? '毎日のように動いています' : undefined}
            />
            <Stat
              label="延べの人数"
              value={number(retention.activeDays)}
              note={
                retention.peakUsers > 0
                  ? `1人あたり ${(retention.activeDays / retention.peakUsers).toFixed(1)} 日`
                  : undefined
              }
            />
            <Stat
              label="いまも動いているか"
              value={retention.aliveNow ? '動いています' : '3日間ゼロ'}
              note={retention.aliveNow ? undefined : '火が消えています'}
            />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            「延べの人数 ÷ いちばん多かった日」が、ひとりが平均して何日続けたかの目安。
            <strong>1.0 に近いなら、来た人がその日だけで去っています。</strong>
            誰が続けたかは追っていません。何人続いたかが分かれば足ります。
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-[15px] font-bold">日ごと</h2>
          <div className="mt-2 overflow-x-auto rounded-[14px] border border-line">
            <table className="w-full min-w-[1120px] border-collapse text-[13px] tabular-nums">
              <thead className="bg-sunken text-left text-[11px] text-muted">
                <tr>
                  {['日付', '話した人', '使い始めた', '回数', '呼び出し', '1通あたり', '送った量', '使い回し', '書いた量', '費用', '1人あたり', '取り込み', '通知', '上限（ゲスト/会員/有料）', '有料になった人'].map(
                    (label) => (
                      <th key={label} className="whitespace-nowrap px-3 py-2 font-medium">
                        {label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.day} className="whitespace-nowrap border-t border-line">
                    <td className="px-3 py-2 font-medium">{row.day.slice(5)}</td>
                    <td className="px-3 py-2">{number(row.users)}</td>
                    <td className="px-3 py-2">{number(row.signups)}</td>
                    <td className="px-3 py-2">{number(row.turns)}</td>
                    <td className="px-3 py-2">{number(row.calls)}</td>
                    <td className="px-3 py-2">
                      {row.callsPerTurn === null ? '—' : `${row.callsPerTurn.toFixed(1)}回`}
                    </td>
                    <td className="px-3 py-2">{number(row.inputTokens)}</td>
                    <td className="px-3 py-2">
                      {row.cachedRatio === null ? '—' : `${Math.round(row.cachedRatio * 100)}%`}
                    </td>
                    <td className="px-3 py-2">{number(row.outputTokens)}</td>
                    <td className="px-3 py-2">{yen(row.yen)}</td>
                    <td className="px-3 py-2">{yen(row.yenPerUser)}</td>
                    <td className="px-3 py-2">{number(row.imports)}</td>
                    <td className="px-3 py-2">{number(row.pushSent)}</td>
                    <td className="px-3 py-2">
                      {number(row.limitGuest)} / {number(row.limitMember)} / {number(row.limitPremium)}
                    </td>
                    <td className="px-3 py-2">
                      {number(row.subscribed)}
                      {row.unsubscribed > 0 ? ` / -${number(row.unsubscribed)}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            費用は 1ドル={USD_TO_JPY}円 と、環境変数 GEMINI_PRICE_PER_MTOK に入れた単価で計算した目安です。
            いま動いているのは <strong>{modelName()}</strong>（画像は <strong>{visionModelName()}</strong>）。
            <strong>入れてある単価が、このモデルのものか確かめてください。</strong>
            モデルを変えて単価を置き忘れると、ここの金額だけが古いモデルのまま何倍にもなります。
            正確な金額は Google の請求画面で確かめてください。
            「上限（会員）」が増えてきたら、有料の枠に人が動く頃合い。<strong>「上限（有料）」が増えるなら、枠か値段が合っていません。</strong>
            <br />
            「1通あたり」は、1通の返事のためにモデルを何回呼んだか。呼ぶたびに固定の指示文と道具の説明を
            送り直しているので、<strong>ここが 1 に近いほど安くなります</strong>。
            <br />
            「使い回し」は、送った量のうち前置きを使い回せた割合。
            指示文は「誰にとっても同じ規範 → その人のこと → 今日のこと」の順に並べてあります。
            <strong>ここが 0% のままなら、その並びが効いていません。</strong>
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-[15px] font-bold">返答への評価</h2>
          <p className="mt-1 text-[12px] text-muted">「良くない」の理由が、いちばんの改善の材料です。</p>
          {feedback.error && <Notice>評価を読めませんでした（{feedback.error}）。schema.sql の「5.」を実行してください。</Notice>}
          <ul className="mt-3 space-y-2">
            {feedback.items.length === 0 && !feedback.error && <Empty>まだありません。</Empty>}
            {feedback.items.map((item, index) => (
              <li key={`${item.at}-${index}`} className="rounded-[12px] border border-line px-3.5 py-3 text-[13px]">
                <div className="flex items-center gap-2 text-[11px] text-muted">
                  <span className={item.payload.rating === 'bad' ? 'font-bold text-warn' : 'font-bold text-good'}>
                    {item.payload.rating === 'bad' ? '良くない' : '良い'}
                  </span>
                  <span>{time(item.at)}</span>
                  {typeof item.payload.coach === 'string' && <span>{item.payload.coach}</span>}
                </div>
                {typeof item.payload.reason === 'string' && item.payload.reason && (
                  <p className="mt-1.5 font-medium">{item.payload.reason}</p>
                )}
                {typeof item.payload.reply === 'string' && (
                  <p className="mt-1.5 line-clamp-4 whitespace-pre-wrap text-muted">{item.payload.reply}</p>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-[15px] font-bold">不具合</h2>
          {errors.error && <Notice>不具合の記録を読めませんでした（{errors.error}）。schema.sql の「5.」を実行してください。</Notice>}
          <ul className="mt-3 space-y-2">
            {errors.items.length === 0 && !errors.error && <Empty>記録された不具合はありません。</Empty>}
            {errors.items.map((item, index) => (
              <li key={`${item.at}-${index}`} className="rounded-[12px] border border-line px-3.5 py-3 text-[12px]">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
                  <span className="font-bold text-warn">{String(item.payload.where ?? '')}</span>
                  <span>{time(item.at)}</span>
                  {typeof item.payload.build === 'string' && <span>build {item.payload.build}</span>}
                  {item.userId && <span>user {item.userId.slice(0, 8)}</span>}
                </div>
                <p className="mt-1.5 break-words font-medium">{String(item.payload.message ?? '')}</p>
                {typeof item.payload.detail === 'string' && item.payload.detail && (
                  <p className="mt-1 break-words text-muted">{item.payload.detail}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-[14px] border border-line px-3.5 py-3">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-1 text-[22px] font-bold tabular-nums">{value}</p>
      {note && <p className="mt-0.5 text-[11px] text-muted">{note}</p>}
    </div>
  );
}

function Notice({ children, tone = 'warn' }: { children: React.ReactNode; tone?: 'warn' | 'muted' }) {
  const colors = tone === 'warn' ? 'border-[color:var(--warn)] bg-warn-soft text-warn' : 'border-line bg-sunken text-muted';
  return <p className={`mt-4 rounded-[12px] border px-3.5 py-3 text-[12px] leading-relaxed ${colors}`}>{children}</p>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <li className="rounded-[12px] bg-sunken px-3.5 py-3 text-[12px] text-muted">{children}</li>;
}
