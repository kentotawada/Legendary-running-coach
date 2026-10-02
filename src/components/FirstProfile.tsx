'use client';

import GoalEditor, { type ProfileEdit } from './GoalEditor';
import CoachAvatar from './CoachAvatar';
import type { CoachCharacter } from '@/lib/characters';
import type { RunnerProfile } from '@/lib/types';

/**
 * コーチが決まった直後に、自分のことを入れてもらう画面。
 *
 * **これまでは、ここが無かった。**
 * コーチを選んだ瞬間に空のチャットへ出て、目標も体のことも
 * 会話の中で少しずつ聞く作りだった。それだと
 *  - 聞くのに1往復ずつ費用がかかる
 *  - 何を知られているのか、本人が把握できない
 *  - 初日のコーチが、何も知らないまま話すことになる
 *
 * 欄をまとめて出す。**全部任意。** 空のまま進んでよい。
 * あとからカルテで、1項目ずつ押して見る・変えることができる。
 */
export default function FirstProfile({
  coach,
  profile,
  saving,
  onSave,
  onSkip,
}: {
  coach: CoachCharacter;
  profile: RunnerProfile | null;
  saving: boolean;
  onSave: (edit: ProfileEdit) => void;
  onSkip: () => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <div className="scroll-area flex-1 overflow-y-auto px-4 pb-6 pt-8">
        <div className="flex items-center gap-3">
          <CoachAvatar character={coach} size={44} />
          <div className="min-w-0">
            <p className="text-[17px] font-bold">あなたのことを教えてください</p>
            <p className="mt-0.5 text-[12px] text-muted">
              全部あとから変えられます。空のままでも始められます。
            </p>
          </div>
        </div>

        <div className="mt-5">
          <GoalEditor
            profile={profile}
            saving={saving}
            onSave={onSave}
            onCancel={onSkip}
            cancelLabel="あとで"
            showCoachPicker={false}
          />
        </div>
      </div>
    </div>
  );
}
