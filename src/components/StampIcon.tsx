import type { StampId } from '@/lib/daily';

/**
 * 今日のスタンプの絵。
 *
 * **絵文字をやめた。** 端末ごとに絵柄が変わるうえ、
 * 「⚖️」は天秤であって体重計ではないし、「👟」は色が薄くて何の靴か読めない。
 * 押せた／まだ、の違いも、絵文字では灰色にするしかなかった。
 *
 * 描き方:
 *  - **28pxで読めること。** 細い線や小さな飾りは、この大きさで消える
 *  - 色は1色（currentColor）。押せた時は色が変わるだけで、絵柄は変えない
 *  - 抜きは面の色を使う。輪郭線を重ねるより、小さくしても潰れない
 */

const SURFACE = 'var(--bg-elevated)';

function Speech() {
  return (
    <>
      {/* 吹き出し。コーチと話す、が「会う」の中身。 */}
      <path
        d="M4 8a4 4 0 0 1 4-4h16a4 4 0 0 1 4 4v9a4 4 0 0 1-4 4h-8.6l-5.9 4.7A.8.8 0 0 1 8.2 25v-4H8a4 4 0 0 1-4-4z"
        fill="currentColor"
      />
      {/* 顔。目と口があるだけで、通知ではなく「人と話す」に読める。 */}
      <circle cx={12} cy={11.5} r={1.7} fill={SURFACE} />
      <circle cx={20} cy={11.5} r={1.7} fill={SURFACE} />
      <path
        d="M11.5 15.6a5.2 5.2 0 0 0 9 0"
        fill="none"
        stroke={SURFACE}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </>
  );
}

function Scale() {
  return (
    <>
      {/*
        体重計を真上から見た形。
        **文字盤と針では、この大きさで何の機械か分からなかった。**
        足あとを2つ置くと、「乗るもの」だと一目で読める。
      */}
      <rect x={3} y={4} width={26} height={25} rx={5} fill="currentColor" />
      {/* 表示窓 */}
      <rect x={10} y={7} width={12} height={4.6} rx={2.3} fill={SURFACE} />
      {/* 足あと */}
      <ellipse cx={11.4} cy={20.4} rx={3.1} ry={5} fill={SURFACE} />
      <ellipse cx={20.6} cy={20.4} rx={3.1} ry={5} fill={SURFACE} />
    </>
  );
}

function Runner() {
  return (
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth={3.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* 走る人。歩く・補強でも、いちばん伝わるのは走る形。 */}
      <circle cx={21.5} cy={6.4} r={3.4} fill="currentColor" stroke="none" />
      <path d="M19.5 12.2 14 18.6" />
      {/* 前の腕は前へ、後ろの腕は後ろへ。左右に振れているほど「走り」に見える。 */}
      <path d="M19 12.8 24.8 14.6 23 18.6" />
      <path d="M19 12.8 13.4 11.4 10 13.8" />
      <path d="M14 18.6 19.4 22.6 17.6 28.4" />
      <path d="M14 18.6 8.4 20.4 9 26" />
    </g>
  );
}

const ART: Record<StampId, () => React.ReactNode> = {
  opened: Speech,
  weighed: Scale,
  moved: Runner,
};

export default function StampIcon({ id, size = 28 }: { id: StampId; size?: number }) {
  const Art = ART[id];
  if (!Art) return null;

  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className="shrink-0"
      role="presentation"
      aria-hidden
    >
      <Art />
    </svg>
  );
}
