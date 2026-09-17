'use client';

import { useState } from 'react';
import type { RunnerProfile } from '@/lib/types';
import type { BuildInfo } from '@/lib/build-info';
import { PHASE_LABEL } from '@/lib/phase';
import PhaseBadge from './PhaseBadge';
import GoalEditor, { type ProfileEdit } from './GoalEditor';
import CoachAvatar from './CoachAvatar';
import { findCharacter } from '@/lib/characters';
import { resolveTargetPace, vdotForTarget } from '@/lib/goals';
import { heartRateZones } from '@/lib/zones';

interface Props {
  profile: RunnerProfile | null;
  build: BuildInfo | null;
  saving: boolean;
  onSave: (edit: ProfileEdit) => void;
  onClose: () => void;
  onReset: () => void;
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
export default function ProfileSheet({ profile, build, saving, onSave, onClose, onReset }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const targetPace = resolveTargetPace(profile?.goal);
  const vdot = vdotForTarget(profile?.goal?.targetTime);
  const zones = profile ? heartRateZones(profile) : null;
  const pains = profile?.pains.filter((p) => p.status !== 'resolved') ?? [];
  const recent = (profile?.activities ?? []).slice(-5).reverse();
  const plan = profile?.plans.at(-1);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/45" role="dialog" aria-modal="true" aria-label="カルテ">
      <button type="button" className="flex-1" aria-label="閉じる" onClick={onClose} />
      <div className="safe-bottom max-h-[82dvh] animate-rise overflow-y-auto rounded-t-3xl border-t border-line bg-elevated">
        <div className="sticky top-0 flex items-center justify-between border-b border-line bg-elevated px-5 py-4">
          <div className="flex items-center gap-2">
            <h2 className="text-[16px] font-bold">コーチのカルテ</h2>
            {profile && <PhaseBadge phase={profile.phase} />}
          </div>
          <div className="flex items-center gap-1">
            {!editing && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-full border border-line px-3 py-1.5 text-[13px] font-medium"
              >
                編集
              </button>
            )}
            <button type="button" onClick={onClose} className="rounded-full px-3 py-1.5 text-[13px] text-muted">
              閉じる
            </button>
          </div>
        </div>

        <div className="px-5 pb-8 pt-2">
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
                    {profile.goal.raceName && <span className="block text-muted">大会: {profile.goal.raceName}</span>}
                    {profile.goal.raceDate && <span className="block text-muted">本番: {profile.goal.raceDate}</span>}
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
      </div>
    </div>
  );
}
