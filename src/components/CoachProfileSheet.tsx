'use client';

import { useState } from 'react';
import {
  COACH_CHARACTERS,
  GENDER_LABEL,
  findCharacter,
  levelInfo,
  type CoachCharacter,
} from '@/lib/characters';
import CoachAvatar from './CoachAvatar';
import Sheet from './Sheet';

interface Props {
  /** いま担当しているコーチの id。 */
  currentId: string | undefined;
  saving: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <h3 className="t-note font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Bullets({ items, marker }: { items: string[]; marker: string }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5 t-body leading-relaxed">
          <span aria-hidden="true" className="mt-[0.45em] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: marker }} />
          <span className="min-w-0 flex-1">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * コーチのプロフィール。
 *
 * 一覧の肩書きだけでは「自分に合うのはどれか」が決められない。
 * 経歴・得意なこと・どんな時に選ぶべきかまで開いて、選ぶ材料を渡す。
 */
export default function CoachProfileSheet({ currentId, saving, onSelect, onClose }: Props) {
  const [viewingId, setViewingId] = useState(currentId ?? findCharacter(undefined).id);
  const coach: CoachCharacter = findCharacter(viewingId);
  const isCurrent = coach.id === (currentId ?? findCharacter(undefined).id);

  return (
    <Sheet label="コーチのプロフィール" onClose={onClose} title="コーチを選ぶ">
      {/* 横に並べて、顔を見ながら切り替えられるようにする。 */}
      <div className="scroll-area -mx-5 flex gap-3 overflow-x-auto px-5 pb-1 pt-1">
        {COACH_CHARACTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setViewingId(item.id)}
            className="flex w-[64px] shrink-0 flex-col items-center gap-1.5"
            aria-pressed={item.id === viewingId}
          >
            <CoachAvatar character={item} size={54} ring={item.id === viewingId} />
            <span
              className={`w-full truncate text-center t-note ${
                item.id === viewingId ? 'font-semibold text-fg' : 'text-muted'
              }`}
            >
              {item.name.split(' ')[0]}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-5 flex items-start gap-4">
        <CoachAvatar character={coach} size={72} />
        <div className="min-w-0 flex-1">
          <p className="t-title font-bold leading-tight">{coach.name}</p>
          <p className="mt-0.5 t-note text-muted">{coach.reading}</p>
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 t-note">
            <span
              className="rounded-full px-2 py-0.5 font-semibold"
              style={{ background: `${coach.color}1f`, color: coach.color }}
            >
              {coach.title}
            </span>
            <span
              className="rounded-full px-2 py-0.5 font-semibold"
              style={{
                background: `${levelInfo(coach.level).color}1f`,
                color: levelInfo(coach.level).color,
              }}
            >
              {levelInfo(coach.level).label}
            </span>
            <span className="text-muted">
              {GENDER_LABEL[coach.gender]}・{coach.age}
            </span>
          </p>
        </div>
      </div>

      <p className="mt-2 t-note leading-relaxed text-muted">
        「{levelInfo(coach.level).label}」は{levelInfo(coach.level).demand}
        。{levelInfo(coach.level).who}
      </p>

      <p className="mt-4 t-body leading-relaxed">{coach.description}</p>

      <Section title="こういう人におすすめ">
        <Bullets items={coach.recommendedFor} marker={coach.color} />
      </Section>

      <Section title="話し方の例">
        <blockquote
          className="rounded-[14px] border-l-[3px] bg-sunken px-4 py-3 t-body leading-relaxed"
          style={{ borderColor: coach.color }}
        >
          {coach.sample}
        </blockquote>
      </Section>

      <Section title="得意なこと">
        <div className="flex flex-wrap gap-1.5">
          {coach.strengths.map((item) => (
            <span key={item} className="rounded-full bg-sunken px-3 py-1.5 t-note">
              {item}
            </span>
          ))}
        </div>
      </Section>

      <Section title="経歴">
        <Bullets items={coach.career} marker="var(--fg-muted)" />
      </Section>

      <p className="mt-6 rounded-[14px] bg-sunken px-4 py-3 t-note leading-relaxed text-muted">
        変わるのは話し方だけです。指導の中身、痛みへの配慮、走れなかった日を責めない原則は、
        どのコーチを選んでも変わりません。
      </p>

      <div className="sticky bottom-0 -mx-5 mt-5 border-t border-line bg-elevated px-5 pb-2 pt-3">
        <button
          type="button"
          disabled={saving || isCurrent}
          onClick={() => onSelect(coach.id)}
          className="w-full rounded-full bg-accent px-4 py-3.5 t-body font-semibold text-[var(--accent-fg)] disabled:opacity-40"
        >
          {isCurrent ? `${coach.name} が担当しています` : saving ? '切り替えています…' : `${coach.name} に担当してもらう`}
        </button>
      </div>
    </Sheet>
  );
}
