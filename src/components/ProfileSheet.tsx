'use client';

import { useEffect, useState } from 'react';
import type { ActivityLog, RunnerProfile } from '@/lib/types';
import type { BuildInfo } from '@/lib/build-info';
import { PHASE_LABEL } from '@/lib/phase';
import Sheet from './Sheet';
import GoalEditor, { type ProfileEdit } from './GoalEditor';
import CoachAvatar from './CoachAvatar';
import { addressFor, findCharacter } from '@/lib/characters';
import { resolveTargetPace, vdotForTarget } from '@/lib/goals';
import { RACE_PRIORITY_LABEL, daysUntil, racesOf, targetRace } from '@/lib/races';
import { FONT_SIZES, type FontSizeId } from '@/lib/display';
import { heartRateZones } from '@/lib/zones';
import { SHOE_ROLE_LABEL, shoeStatuses } from '@/lib/shoes';
import {
  currentSubscription,
  pushAvailability,
  sendTestPush,
  subscribeToPush,
  unsubscribeFromPush,
  type PushAvailability,
} from '@/lib/push-client';
import { NOTIFY_HOURS, notifyHourOf } from '@/lib/nudge';

interface Props {
  profile: RunnerProfile | null;
  /** 記録がどこに保存されているかを示すために使う。 */
  signedInAs?: string;
  authAvailable?: boolean;
  onOpenAuth?: () => void;
  build: BuildInfo | null;
  saving: boolean;
  /** 文字の大きさ。この端末だけの設定なので、カルテの保存とは別に即時反映する。 */
  fontSize: FontSizeId;
  onChangeFontSize: (id: FontSizeId) => void;
  onSave: (edit: ProfileEdit) => void;
  onClose: () => void;
  onReset: () => void;
  /** このアプリで Strava 連携が使える設定になっているか。 */
  stravaAvailable?: boolean;
  /** このアプリで通知が使える設定になっているか。 */
  pushAvailable?: boolean;
  /** 通知を受け取る時刻を決める。 */
  onChangeNotifyHour?: (hour: number) => void;
  /** 時計・アプリとの連携画面を開く。 */
  onOpenConnect?: () => void;
  /** 1本の練習の中身（区間・心拍の推移）を開く。 */
  onOpenRun?: (activity: ActivityLog) => void;
}

/**
 * カルテの区切り。
 *
 * **3種類のものが1列に並んでいた。** 「あなたのこと」「記録」「設定」は
 * 見る目的が違うのに、同じ太さの線で延々とつながっていたので、
 * 探しているものにたどり着けなかった。見出しで切る。
 */
function Group({
  title,
  when = true,
  children,
}: {
  title: string;
  /**
   * 中身が1つでもあるか。
   * **空の見出しを出さない。** 中の行はどれも条件つきなので、
   * まだ何も記録していない人には、名前だけの区切りが並ぶことになる。
   */
  when?: boolean;
  children: React.ReactNode;
}) {
  if (!when) return null;
  return (
    <section className="mt-5 first:mt-1">
      <h3 className="mb-0.5 text-[11px] font-bold tracking-[0.14em] text-muted">{title}</h3>
      <dl className="divide-y divide-[color:var(--border)]">{children}</dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-2">
      <dt className="w-24 shrink-0 text-[13px] text-muted">{label}</dt>
      <dd className="flex-1 text-[14px] leading-relaxed">{children}</dd>
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = {
  run: 'ラン',
  walk: 'ウォーク',
  cross: 'クロストレーニング',
  strength: '補強',
  stretch: 'ストレッチ',
  rest: '完全休養',
};

/** 日付を「9/24（木）」の形に。年は、今の年と違う時だけ出す。 */
function shortDate(date: string, now = new Date()): string {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return date;
  const weekday = '日月火水木金土'[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const head = year === now.getFullYear() ? '' : `${year}/`;
  return `${head}${month}/${day}（${weekday}）`;
}

/**
 * 1本の練習を1行で。
 *
 * **文字を並べただけだと、読み飛ばされる。**
 * 日付・種目・数値・本人の言葉は役割が違うので、見た目でも分ける。
 * 数値は等幅にして、縦に並んだ時に桁が揃うようにする。
 */
function ActivityRow({
  activity,
  onOpen,
}: {
  activity: ActivityLog;
  onOpen?: (activity: ActivityLog) => void;
}) {
  // 区間が入っている練習だけ、中身を開けるようにする。
  // 開けない記録に矢印を出すと、押しても何も起きない。
  const openable = (activity.laps?.length ?? 0) > 1 && Boolean(onOpen);

  const numbers = [
    activity.distanceKm !== undefined ? `${activity.distanceKm}km` : null,
    activity.durationMin !== undefined ? `${activity.durationMin}分` : null,
    activity.metrics?.avgPace ?? null,
    // 「♥」は端末によって赤い絵文字になる。単位で書けば、どこで見ても同じ。
    activity.metrics?.avgHr !== undefined ? `${activity.metrics.avgHr}bpm` : null,
  ].filter((value): value is string => Boolean(value));

  const body = (
    <span className="block rounded-[12px] border border-line bg-bg px-3 py-2">
      {/*
        **絵文字を印に使わない。** 端末ごとに絵柄も色も変わるうえ、
        種目の名前（ラン／補強）はすぐ右に文字で出ている。印は要らなかった。
      */}
      <span className="flex items-center gap-2">
        <span className="shrink-0 text-[12px] font-semibold tabular-nums">
          {shortDate(activity.date)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-muted">
          {activity.session ?? TYPE_LABEL[activity.type] ?? activity.type}
        </span>
        {openable && (
          <span className="shrink-0 text-[11px] font-semibold text-accent">
            区間{activity.laps!.length} ›
          </span>
        )}
      </span>

      {numbers.length > 0 && (
        <span className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[13px] tabular-nums">
          {numbers.map((value, index) => (
            <span key={value} className={index === 0 ? 'font-bold' : ''}>
              {value}
            </span>
          ))}
        </span>
      )}

      {/* 本人の言葉は、数値と同じ見た目にしない。時計に測れない情報なので、別の行に。 */}
      {activity.felt && (
        <span className="mt-1 block border-l-2 border-line pl-2 text-[11px] leading-relaxed text-muted">
          {activity.felt}
        </span>
      )}
    </span>
  );

  if (!openable) return body;
  return (
    <button type="button" onClick={() => onOpen!(activity)} className="block w-full text-left active:opacity-70">
      {body}
    </button>
  );
}

/**
 * コーチが何を覚えているかを、本人がいつでも確認・削除できる画面。
 * 「勝手に学習されている」不安を残さないための装置でもある。
 */
export default function ProfileSheet({
  profile,
  build,
  saving,
  signedInAs,
  authAvailable,
  onOpenAuth,
  fontSize,
  onChangeFontSize,
  onClose,
  onSave,
  onReset,
  stravaAvailable = false,
  pushAvailable = false,
  onOpenConnect,
  onChangeNotifyHour,
  onOpenRun,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const targetPace = resolveTargetPace(profile?.goal);
  const vdot = vdotForTarget(profile?.goal?.targetTime);
  const zones = profile ? heartRateZones(profile) : null;
  const races = profile ? racesOf(profile) : [];
  const focus = profile ? targetRace(profile) : undefined;
  const pains = profile?.pains.filter((p) => p.status !== 'resolved') ?? [];
  const recent = (profile?.activities ?? []).slice(-5).reverse();
  const shoes = profile ? shoeStatuses(profile) : [];
  const strava = profile?.connections?.strava;
  const [pushState, setPushState] = useState<PushAvailability>('unsupported');
  const [subscribed, setSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const notifyHour = profile ? notifyHourOf(profile) : 9;
  const [pushNote, setPushNote] = useState<string | null>(null);

  // 端末側の状態は、描かれた後でないと分からない（サーバーでは判定できない）。
  useEffect(() => {
    setPushState(pushAvailability());
    void currentSubscription().then((subscription) => setSubscribed(Boolean(subscription)));
  }, []);

  const toggleNotifications = async () => {
    setPushBusy(true);
    setPushNote(null);
    try {
      if (subscribed) {
        await unsubscribeFromPush();
        setSubscribed(false);
        setPushNote('通知を止めました。');
        return;
      }
      const result = await subscribeToPush();
      setSubscribed(result.ok);
      setPushNote(
        result.ok
          ? '通知を受け取れるようになりました。送るのは1日に1通までです。'
          : result.reason === 'denied'
            ? '端末側で通知が拒否されました。設定アプリから許可すると受け取れます。'
            : '通知を設定できませんでした。',
      );
    } finally {
      setPushBusy(false);
    }
  };
  const gearNotes = profile?.gearNotes ?? [];
  const plan = profile?.plans.at(-1);

  return (
    <Sheet
      label="カルテ"
      title="カルテ"
      onClose={onClose}
      action={
        !editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="shrink-0 rounded-full border border-line px-3.5 py-1.5 text-[13px] font-medium"
          >
            編集
          </button>
        ) : undefined
      }
    >
      <div className="pt-1">
          {editing ? (
            <GoalEditor
              profile={profile}
              saving={saving}
              onSave={(edit) => {
                onSave(edit);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : !profile ? (
            <p className="py-6 text-center text-[14px] text-muted">まだ何も記録されていません。</p>
          ) : (
            <>
            <Group title="あなたのこと">
                <Row label="コーチ">
                  <span className="flex items-center gap-2">
                    <CoachAvatar character={findCharacter(profile.characterId)} size={26} />
                    <span>
                      {findCharacter(profile.characterId).name}
                      <span className="ml-1.5 text-[12px] text-muted">
                        {findCharacter(profile.characterId).tagline}
                      </span>
                    </span>
                  </span>
                </Row>
                {/* 敬称はコーチごとに違うので、実際に呼ばれる形をそのまま出す。 */}
                <Row label="呼び方">
                  {addressFor(profile.characterId, profile.displayName) ?? (
                    <span className="text-muted">まだ決めていません</span>
                  )}
                </Row>
                <Row label="現在地">{PHASE_LABEL[profile.phase]}</Row>
                <Row label="目標">
                  {profile.goal && profile.goal.kind !== 'none' ? (
                    <>
                      <span className="font-medium">{profile.goal.summary}</span>
                      {profile.goal.targetTime && <span className="block text-muted">目標タイム: {profile.goal.targetTime}</span>}
                      {targetPace && <span className="block text-muted">目標ペース: {targetPace}</span>}
                      {/*
                        **VDOT に1行を与えない。** 目標タイムから計算した数字なので、
                        目標から離して並べると、別の何かに見える。ここに小さく添える。
                      */}
                      {vdot !== undefined && (
                        <span className="block text-[12px] text-muted">VDOT {vdot.toFixed(1)}（目標から計算した走力の目安）</span>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditing(true)}
                      className="rounded-full bg-accent px-3.5 py-2 text-[13px] font-semibold text-[var(--accent-fg)]"
                    >
                      目標を設定する
                    </button>
                  )}
                </Row>
                {/*
                  **表示の設定は、いちばん下でいい。**
                  自分のカルテを開いてまず目に入るのが文字サイズの選択では、
                  本人の目標も状態も、その下に押し下げられてしまう。
                */}
                {races.length > 0 && (
                  <Row label="出場する大会">
                    <ul className="space-y-1.5">
                      {races.map((race) => {
                        const left = daysUntil(race.date);
                        const isTarget = race.id === focus?.id;
                        return (
                          <li key={race.id}>
                            <span className={isTarget ? 'font-medium' : undefined}>{race.name}</span>
                            <span className="ml-1.5 text-[12px] text-muted">
                              {race.priority}・{RACE_PRIORITY_LABEL[race.priority]}
                              {race.distance ? ` / ${race.distance}` : ''}
                            </span>
                            <span className="block text-[12px] text-muted">
                              {race.date}
                              {left === undefined
                                ? ''
                                : left > 0
                                  ? `（あと${left}日）`
                                  : left === 0
                                    ? '（今日）'
                                    : '（終了）'}
                              {race.targetTime ? ` / 目標 ${race.targetTime}` : ''}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </Row>
                )}
                <Row label="心拍">
                  {profile.maxHr || profile.lthr || profile.restingHr ? (
                    <>
                      {[
                        profile.maxHr ? `最大 ${profile.maxHr}` : null,
                        profile.lthr ? `LTHR ${profile.lthr}` : null,
                        profile.restingHr ? `安静時 ${profile.restingHr}` : null,
                      ]
                        .filter(Boolean)
                        .join(' / ')}
                      {zones && zones.zones.length > 0 && (
                        <span className="mt-1 block text-[12px] text-muted">{zones.basisLabel}</span>
                      )}
                    </>
                  ) : (
                    <span className="text-muted">未設定（ゾーン評価には最大心拍数が必要です）</span>
                  )}
                </Row>
                {profile.injuryHistory?.length ? (
                  <Row label="故障歴">
                    <ul className="list-disc space-y-1 pl-4">
                      {profile.injuryHistory.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </Row>
                ) : null}
                <Row label="体の状態">
                  {pains.length > 0 ? (
                    <ul className="space-y-1">
                      {pains.map((p) => (
                        <li key={p.id} className="text-warn">
                          {p.site} — 強さ {p.severity}/5（{p.status === 'improving' ? '回復傾向' : '継続中'}）
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-good">痛みの記録はありません</span>
                  )}
                </Row>
                {profile.experience && <Row label="経験">{profile.experience}</Row>}
                {profile.weeklyVolumeKm !== undefined && <Row label="週間距離">約 {profile.weeklyVolumeKm} km</Row>}
                {profile.availableDays?.length ? <Row label="走れる曜日">{profile.availableDays.join('・')}</Row> : null}
                {profile.typicalSessionMinutes !== undefined && (
                  <Row label="使える時間">1回 約 {profile.typicalSessionMinutes} 分</Row>
                )}
                {profile.constraints?.length ? (
                  <Row label="生活の制約">
                    <ul className="list-disc space-y-1 pl-4">
                      {profile.constraints.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </Row>
                ) : null}
                {profile.motivations?.length ? (
                  <Row label="走る理由">
                    <ul className="list-disc space-y-1 pl-4">
                      {profile.motivations.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </Row>
                ) : null}
            </Group>
            <Group title="道具" when={shoes.length > 0 || gearNotes.length > 0}>
                {shoes.length > 0 && (
                  <Row label="シューズ">
                    <ul className="space-y-2.5">
                      {shoes.map(({ shoe, lifespan, remainingKm, ratio, level, weeksLeft }) => (
                        <li key={shoe.id}>
                          <span className="font-medium">{shoe.name}</span>
                          <span className="ml-1.5 text-[12px] text-muted">{SHOE_ROLE_LABEL[shoe.role]}</span>
                          <span
                            aria-hidden="true"
                            className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-sunken"
                          >
                            <span
                              className={`block h-full rounded-full ${
                                level === 'over' ? 'bg-warn' : level === 'caution' ? 'bg-accent' : 'bg-good'
                              }`}
                              style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }}
                            />
                          </span>
                          <span className="mt-1 block text-[12px] text-muted tabular-nums">
                            {Math.round(shoe.km)} km / 目安 {lifespan.replace} km
                            {level === 'over'
                              ? `（${-remainingKm}km 超過）`
                              : weeksLeft !== undefined
                                ? `（残り ${remainingKm}km・約${weeksLeft}週）`
                                : `（残り ${remainingKm}km）`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Row>
                )}
                {gearNotes.length > 0 && (
                  <Row label="道具の相性">
                    <ul className="space-y-1">
                      {gearNotes
                        .slice()
                        .reverse()
                        .slice(0, 8)
                        .map((note) => (
                          <li key={note.id} className={note.verdict === 'bad' ? 'text-warn' : 'text-good'}>
                            {note.verdict === 'bad' ? '合わなかった' : '合った'}: {note.name}
                            {note.reason ? <span className="text-muted">（{note.reason}）</span> : null}
                          </li>
                        ))}
                    </ul>
                    <span className="mt-1 block text-[12px] text-muted">
                      「合わなかった」ものは、商品を探す時に候補から外れます
                    </span>
                  </Row>
                )}
            </Group>
            <Group title="記録" when={Boolean(plan) || recent.length > 0 || profile.phaseHistory.length > 0}>
                {plan && (
                  <Row label="直近のメニュー">
                    <span className="font-medium">{plan.title}</span>
                    <ul className="mt-1 list-decimal space-y-0.5 pl-4 text-muted">
                      {plan.steps.map((s, i) => (
                        <li key={`${plan.id}-${i}`}>{s}</li>
                      ))}
                    </ul>
                  </Row>
                )}
                <Row label="直近の記録">
                  {recent.length > 0 ? (
                    <ul className="-mr-1 space-y-1.5">
                      {recent.map((a) => (
                        <li key={a.id}>
                          <ActivityRow activity={a} onOpen={onOpenRun} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-muted">
                      まだありません。
                      <span className="mt-0.5 block text-[11px]">
                        上の「記録を取り込む」から、時計のファイルを入れられます。
                      </span>
                    </span>
                  )}
                </Row>
                {profile.phaseHistory.length > 0 && (
                  <Row label="歩み">
                    {/*
                      **畳んでおく。** これはコーチ側が段階を切り替えた理由の記録で、
                      毎日見るものではない。開いたままだと、長い注釈で画面が埋まる。
                    */}
                    <details>
                      <summary className="cursor-pointer text-[13px] text-muted">
                        {profile.phaseHistory.length}回の変化
                      </summary>
                      <ul className="mt-1.5 space-y-1 text-muted">
                        {profile.phaseHistory.slice(-4).map((h) => (
                          <li key={h.at}>
                            {PHASE_LABEL[h.from]} → {PHASE_LABEL[h.to]}（{h.reason}）
                          </li>
                        ))}
                      </ul>
                    </details>
                  </Row>
                )}
            </Group>
            <Group title="設定">
                <Row label="アプリ連携">
                    {strava ? (
                      <>
                        <span className="font-semibold text-accent">Strava と連携中</span>
                        {strava.athleteName && (
                          <span className="ml-1.5 text-[12px] text-muted">{strava.athleteName}</span>
                        )}
                        <span className="mt-0.5 block text-[12px] text-muted">
                          {strava.lastSyncedAt
                            ? `最終取り込み ${new Date(strava.lastSyncedAt).toLocaleString('ja-JP', {
                                month: 'numeric',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}`
                            : 'まだ取り込んでいません'}
                          {strava.imported ? ` / これまで${strava.imported}件` : ''}
                        </span>
                      </>
                    ) : stravaAvailable ? (
                      <span className="text-muted">
                        つないでおくと、走り終えた時点で記録が入っています。
                        スクリーンショットを送る必要がなくなります
                      </span>
                    ) : (
                      <span className="text-muted">
                        時計から書き出したファイル（GPX / TCX）から、過去の練習をまとめて取り込めます
                      </span>
                    )}
                    {/*
                      取り込みも解除も手順も、連携の画面に集めてある。
                      ここに同じ操作を並べると、どちらが正しい入口か分からなくなる。
                    */}
                    <button
                      type="button"
                      onClick={onOpenConnect}
                      className="mt-2.5 block w-fit rounded-full border border-[color:var(--accent)] px-3.5 py-2 text-[13px] font-semibold text-accent"
                    >
                      {strava ? '連携の設定を開く' : stravaAvailable ? '時計・アプリとつなぐ' : '記録を取り込む'}
                    </button>
                </Row>
                {pushAvailable && (
                  <Row label="通知">
                    {pushState === 'needs-install' ? (
                      <>
                        <span className="text-muted">
                          iPhone では、<strong className="font-semibold text-fg">ホーム画面に追加</strong>
                          すると通知を受け取れます
                        </span>
                        <span className="mt-1 block text-[12px] text-muted">
                          共有ボタン → 「ホーム画面に追加」→ 追加したアイコンから開く
                        </span>
                      </>
                    ) : pushState === 'unsupported' ? (
                      <span className="text-muted">この端末では通知を使えません</span>
                    ) : (
                      <>
                        <span className={subscribed ? 'font-medium text-good' : 'text-muted'}>
                          {subscribed ? '受け取る設定になっています' : '靴の寿命や本番前に、こちらから声をかけます'}
                        </span>
                        <span className="mt-0.5 block text-[12px] text-muted">
                          送るのは1日に1通まで。走れていない日を責めることはしません
                        </span>
                        <button
                          type="button"
                          onClick={() => void toggleNotifications()}
                          disabled={pushBusy}
                          className={`mt-1.5 rounded-full px-3.5 py-2 text-[13px] font-semibold disabled:opacity-40 ${
                            subscribed
                              ? 'border border-line text-fg'
                              : 'bg-accent text-[var(--accent-fg)]'
                          }`}
                        >
                          {pushBusy ? '設定中…' : subscribed ? '通知を止める' : '通知を受け取る'}
                        </button>
                        {pushNote && <span className="mt-1.5 block text-[12px] text-accent">{pushNote}</span>}

                        {/*
                          **朝が全員にとって良い時間とは限らない。**
                          夜に走る人に朝9時の声かけは早すぎるし、早朝に出る人には遅い。
                          受け取っている人にだけ出す。切っている人には意味が無い。
                        */}
                        {subscribed && onChangeNotifyHour && (
                          <span className="mt-3 block">
                            <span className="block text-[12px] text-muted">受け取る時刻</span>
                            <span className="mt-1 flex flex-wrap gap-1.5">
                              {NOTIFY_HOURS.map((hour) => {
                                const active = notifyHour === hour;
                                return (
                                  <button
                                    key={hour}
                                    type="button"
                                    onClick={() => onChangeNotifyHour(hour)}
                                    aria-pressed={active}
                                    className={[
                                      'min-w-[46px] rounded-[10px] border py-1.5 text-[13px] tabular-nums transition active:scale-[0.97]',
                                      active
                                        ? 'border-[color:var(--accent)] bg-accent-soft font-semibold text-accent'
                                        : 'border-line text-fg',
                                    ].join(' ')}
                                  >
                                    {hour}時
                                  </button>
                                );
                              })}
                            </span>

                            {/*
                              **「来ない」には5つの原因があって、外からは全部同じに見える。**
                              端末に届くかどうかと、今日そもそも送る用事があったかを、
                              ここで1回で確かめられるようにする。
                            */}
                            <span className="mt-3 block">
                              <button
                                type="button"
                                disabled={testing}
                                onClick={() => {
                                  setTesting(true);
                                  setPushNote(null);
                                  void sendTestPush()
                                    .then((result) => setPushNote(result.message))
                                    .finally(() => setTesting(false));
                                }}
                                className="rounded-full border border-line px-3.5 py-2 text-[13px] font-semibold disabled:opacity-40"
                              >
                                {testing ? '送っています…' : 'いま1通送ってみる'}
                              </button>
                              <span className="mt-1 block text-[11px] leading-relaxed text-muted">
                                届かない時に、どこで止まっているかを確かめられます
                              </span>
                            </span>
                          </span>
                        )}
                      </>
                    )}
                  </Row>
                )}
                {/*
                  自動連携が使えない時も、この行は出す。
                  書き出したファイルから取り込む道は、設定に関係なく使えるため。
                */}
                {authAvailable && (
                  <Row label="保存先">
                    {signedInAs ? (
                      <>
                        <span className="font-medium">{signedInAs}</span>
                        <span className="block text-[12px] text-muted">
                          どの端末から開いても同じ記録が表示されます
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-muted">この端末にのみ保存されています</span>
                        <button
                          type="button"
                          onClick={onOpenAuth}
                          className="mt-1.5 rounded-full bg-accent px-3.5 py-2 text-[13px] font-semibold text-[var(--accent-fg)]"
                        >
                          ログインして引き継ぐ
                        </button>
                      </>
                    )}
                  </Row>
                )}
                <Row label="文字の大きさ">
                  <div className="flex gap-1.5">
                    {FONT_SIZES.map((size) => (
                      <button
                        key={size.id}
                        type="button"
                        onClick={() => onChangeFontSize(size.id)}
                        aria-pressed={fontSize === size.id}
                        className={[
                          'min-w-[52px] rounded-[10px] border py-1.5 text-[13px] transition active:scale-[0.97]',
                          fontSize === size.id
                            ? 'border-[color:var(--accent)] bg-accent-soft font-semibold text-accent'
                            : 'border-line text-fg',
                        ].join(' ')}
                      >
                        {size.label}
                      </button>
                    ))}
                  </div>
                  <span className="mt-1.5 block text-[12px] leading-relaxed text-muted">
                    {FONT_SIZES.find((size) => size.id === fontSize)?.hint}（この端末にのみ保存されます）
                  </span>
                </Row>
            </Group>
            </>
          )}

          {/* 名前は、ここに静かに置く。ヘッダーはコーチのための場所。 */}
          {!editing && (
            <p className="mt-6 text-center text-[11px] font-bold tracking-[0.18em] text-muted">
              RUNCOACH
            </p>
          )}

          {/*
            記録がどこにあるか。**これは使う人の話なので、いつでも出す。**
            消えては困るものが、どこに置かれているのかを知る権利がある。
          */}
          {!editing && build && (
            <p className="mt-2 rounded-xl bg-sunken px-3 py-2.5 text-[11px] leading-relaxed text-muted">
              記録の保存先:{' '}
              {build.storage === 'supabase'
                ? 'サーバー。ログインしていれば、機種を変えても残ります。'
                : 'この端末のみ。ブラウザの記録を消すと、一緒に消えます。'}
            </p>
          )}

          {/*
            ビルド番号・モデル名・APIキーの有無は、**作っている側の情報。**
            使う人には意味が無く、不安にしかならないし、こちらの中身を晒す必要もない。
            本番では出さない。切り分けが要る場所では、これまで通り見える。
          */}
          {!editing && build && build.environment !== 'production' && (
            <div className="mt-2 rounded-xl border border-dashed border-line px-3 py-2.5 text-[11px] leading-relaxed text-muted">
              <p className="font-medium">開発用の表示</p>
              <p>
                ビルド {build.commit} / {build.environment} / モデル {build.model}（思考 {build.thinkingLevel}）
              </p>
              <p>
                APIキー: {build.hasApiKey ? (build.apiKeyLooksValid ? '設定済み' : '設定済み（形式が怪しい）') : '未設定'}
              </p>
            </div>
          )}

          <div className={`mt-6 border-t border-line pt-4 ${editing ? 'hidden' : ''}`}>
            {confirming ? (
              <div className="space-y-3">
                <p className="text-[13px] text-muted">
                  会話とカルテをすべて消去します。この操作は取り消せません。
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirming(false);
                      onReset();
                      onClose();
                    }}
                    className="flex-1 rounded-full bg-warn px-4 py-3 text-[14px] font-semibold text-[var(--accent-fg)]"
                  >
                    すべて消去する
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className="flex-1 rounded-full border border-line px-4 py-3 text-[14px]"
                  >
                    やめる
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="text-[13px] text-muted underline underline-offset-4"
              >
                記録をすべて消去する
              </button>
            )}
          </div>
      </div>
    </Sheet>
  );
}
