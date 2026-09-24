'use client';

import { useEffect, useState } from 'react';
import type { RunnerProfile } from '@/lib/types';
import type { BuildInfo } from '@/lib/build-info';
import { PHASE_LABEL } from '@/lib/phase';
import Sheet from './Sheet';
import GoalEditor, { type ProfileEdit } from './GoalEditor';
import CoachAvatar from './CoachAvatar';
import { findCharacter } from '@/lib/characters';
import { resolveTargetPace, vdotForTarget } from '@/lib/goals';
import { RACE_PRIORITY_LABEL, daysUntil, racesOf, targetRace } from '@/lib/races';
import { FONT_SIZES, type FontSizeId } from '@/lib/display';
import { heartRateZones } from '@/lib/zones';
import { SHOE_ROLE_LABEL, shoeStatuses } from '@/lib/shoes';
import {
  currentSubscription,
  pushAvailability,
  subscribeToPush,
  unsubscribeFromPush,
  type PushAvailability,
} from '@/lib/push-client';

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
  syncing?: boolean;
  syncMessage?: string | null;
  onSyncStrava?: () => void;
  onDisconnectStrava?: () => void;
  /** Garmin など、時計とのつなぎ方の手順を開く。 */
  onOpenDeviceGuide?: () => void;
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
  syncing = false,
  syncMessage,
  onSyncStrava,
  onDisconnectStrava,
  onOpenDeviceGuide,
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
            <dl className="divide-y divide-[color:var(--border)]">
              <Row label="文字の大きさ">
                <div className="flex gap-2">
                  {FONT_SIZES.map((size) => (
                    <button
                      key={size.id}
                      type="button"
                      onClick={() => onChangeFontSize(size.id)}
                      aria-pressed={fontSize === size.id}
                      className={[
                        'rounded-full border px-4 py-2 transition active:scale-[0.97]',
                        fontSize === size.id
                          ? 'border-[color:var(--accent)] bg-accent-soft font-semibold text-accent'
                          : 'border-line text-fg',
                      ].join(' ')}
                      style={{ fontSize: `${Math.round(14 * size.scale)}px` }}
                    >
                      {size.label}
                    </button>
                  ))}
                </div>
                <span className="mt-1 block text-[12px] text-muted">
                  {FONT_SIZES.find((size) => size.id === fontSize)?.hint}（この端末にのみ保存されます）
                </span>
              </Row>
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
                    </>
                  )}
                </Row>
              )}
              {(stravaAvailable || strava) && (
                <Row label="ランニングアプリ">
                  {strava ? (
                    <>
                      <span className="font-medium">Strava と連携中</span>
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
                      <span className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={onSyncStrava}
                          disabled={syncing}
                          className="rounded-full bg-accent px-3.5 py-2 text-[13px] font-semibold text-[var(--accent-fg)] disabled:opacity-40"
                        >
                          {syncing ? '取り込み中…' : '今すぐ取り込む'}
                        </button>
                        <button
                          type="button"
                          onClick={onDisconnectStrava}
                          disabled={syncing}
                          className="text-[12px] text-muted underline underline-offset-4 disabled:opacity-40"
                        >
                          連携を解除
                        </button>
                      </span>
                      {syncMessage && (
                        <span className="mt-1.5 block text-[12px] text-accent">{syncMessage}</span>
                      )}
                      <button
                        type="button"
                        onClick={onOpenDeviceGuide}
                        className="mt-1.5 block text-[12px] text-muted underline underline-offset-4"
                      >
                        Garmin の時計とつなぐ手順
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="text-muted">
                        つないでおくと、走り終えた時点で記録が入っています。
                        スクリーンショットを送る必要がなくなります
                      </span>
                      <a
                        href="/api/strava/connect"
                        className="mt-1.5 inline-block rounded-full bg-accent px-3.5 py-2 text-[13px] font-semibold text-[var(--accent-fg)]"
                      >
                        Strava とつなぐ
                      </a>
                      <button
                        type="button"
                        onClick={onOpenDeviceGuide}
                        className="mt-1.5 block text-[12px] text-muted underline underline-offset-4"
                      >
                        Garmin の時計をお使いの方へ（つなぎ方の手順）
                      </button>
                    </>
                  )}
                </Row>
              )}
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
              <Row label="現在地">{PHASE_LABEL[profile.phase]}</Row>
              {profile.displayName && <Row label="呼び方">{profile.displayName}さん</Row>}
              <Row label="目標">
                {profile.goal && profile.goal.kind !== 'none' ? (
                  <>
                    <span className="font-medium">{profile.goal.summary}</span>
                    {profile.goal.targetTime && <span className="block text-muted">目標タイム: {profile.goal.targetTime}</span>}
                    {targetPace && <span className="block text-muted">目標ペース: {targetPace}</span>}
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
              {profile.injuryHistory?.length ? (
                <Row label="故障歴">
                  <ul className="list-disc space-y-1 pl-4">
                    {profile.injuryHistory.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </Row>
              ) : null}
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
              {vdot !== undefined && (
                <Row label="VDOT">
                  <span className="font-medium">{vdot.toFixed(1)}</span>
                  <span className="block text-[12px] text-muted">目標タイムから自動計算される走力指標です</span>
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
                  <ul className="space-y-1">
                    {recent.map((a) => (
                      <li key={a.id}>
                        {a.date} {TYPE_LABEL[a.type] ?? a.type}
                        {a.distanceKm !== undefined ? ` ${a.distanceKm}km` : ''}
                        {a.durationMin !== undefined ? ` ${a.durationMin}分` : ''}
                        {a.felt ? <span className="block text-muted">「{a.felt}」</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-muted">まだありません</span>
                )}
              </Row>
              {profile.phaseHistory.length > 0 && (
                <Row label="歩み">
                  <ul className="space-y-1 text-muted">
                    {profile.phaseHistory.slice(-4).map((h) => (
                      <li key={h.at}>
                        {PHASE_LABEL[h.from]} → {PHASE_LABEL[h.to]}（{h.reason}）
                      </li>
                    ))}
                  </ul>
                </Row>
              )}
            </dl>
          )}

          {!editing && build && (
            <div className="mt-6 rounded-xl bg-sunken px-3 py-2.5 text-[11px] leading-relaxed text-muted">
              <p className="font-medium">このアプリの状態</p>
              <p>
                ビルド {build.commit} / {build.environment} / モデル {build.model}（思考 {build.thinkingLevel}）
              </p>
              <p>
                APIキー: {build.hasApiKey ? (build.apiKeyLooksValid ? '設定済み' : '設定済み（形式が怪しい）') : '未設定'}
              </p>
              <p>
                保存先: {build.storage === 'supabase' ? 'Supabase（永続）' : 'この端末・インスタンス限り'}
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
