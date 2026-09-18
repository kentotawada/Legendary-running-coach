import type { CoachCharacter } from '@/lib/characters';

/** コーチの顔アイコン。キャラクターごとに色と表情が変わる。 */
export default function CoachAvatar({
  character,
  size = 40,
}: {
  character: CoachCharacter;
  size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        backgroundColor: `${character.color}22`,
        border: `1.5px solid ${character.color}`,
        fontSize: Math.round(size * 0.52),
        lineHeight: 1,
      }}
    >
      {character.face}
    </span>
  );
}
