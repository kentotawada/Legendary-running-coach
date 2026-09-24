/**
 * 説明図の絵。
 *
 * 全て手で描いている。その場で生成させると、指が6本あったり膝が逆に曲がったりして、
 * それを見て真似た人が故障する。お手本の絵は間違ってはいけない。
 *
 * 線は currentColor、強調だけアクセント色。明るい画面でも暗い画面でも同じように読める。
 * 文字は入れない。手順と注意はカード側の文章で出す。
 */

const LIMB = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 5.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const TORSO = { ...LIMB, strokeWidth: 10 } as const;

/** 伸びている場所・効いている場所。 */
const HILITE = { ...LIMB, stroke: 'var(--accent)', strokeWidth: 8 } as const;
const HILITE_TORSO = { ...HILITE, strokeWidth: 11 } as const;

/** 基準線。まっすぐであること、真下であることを示す。 */
const GUIDE = {
  fill: 'none',
  stroke: 'var(--accent)',
  strokeWidth: 2,
  strokeDasharray: '5 5',
  strokeLinecap: 'round',
  opacity: 0.8,
} as const;

/** 壁・床・段差など、体ではないもの。 */
const PROP = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 3,
  strokeLinecap: 'round',
  opacity: 0.28,
} as const;

function Ground({ y = 142, from = 16, to = 224 }: { y?: number; from?: number; to?: number }) {
  return <line x1={from} y1={y} x2={to} y2={y} {...PROP} />;
}

function Head({ cx, cy, r = 11 }: { cx: number; cy: number; r?: number }) {
  return <circle cx={cx} cy={cy} r={r} fill="currentColor" />;
}

/** 良い例の印。 */
function Check({ x, y }: { x: number; y: number }) {
  return (
    <path
      d={`M${x} ${y + 5} l5 5 l10 -12`}
      fill="none"
      stroke="var(--good)"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

/** 避けたい例の印。 */
function Cross({ x, y }: { x: number; y: number }) {
  return (
    <g fill="none" stroke="var(--warn)" strokeWidth="4" strokeLinecap="round">
      <path d={`M${x} ${y} l12 12`} />
      <path d={`M${x + 12} ${y} l-12 12`} />
    </g>
  );
}

/** 図ごとの絵。id が無ければ null を返し、画面には何も出さない。 */
export function figureArt(id: string): React.ReactNode {
  switch (id) {
    // --- ストレッチ ---
    case 'stretch-hamstring':
      return (
        <>
          <Ground />
          {/* 後ろ脚（支え） */}
          <path d="M92 92 L88 118 L86 142" {...LIMB} />
          {/* 前脚：ここが伸びる */}
          <path d="M92 92 L128 120 L158 140" {...HILITE} />
          <path d="M158 140 L167 127" {...LIMB} />
          {/* 股関節から前傾した胴 */}
          <path d="M92 92 L128 62" {...TORSO} />
          <Head cx={141} cy={51} />
          {/* 前ももに置いた手 */}
          <path d="M128 64 L137 92 L131 111" {...LIMB} />
        </>
      );

    case 'stretch-calf':
      return (
        <>
          <Ground />
          {/* 壁 */}
          <line x1="206" y1="26" x2="206" y2="142" {...PROP} strokeWidth={4} />
          {/* 前脚（曲げる） */}
          <path d="M88 98 L120 118 L144 142" {...LIMB} />
          {/* 後ろ脚：ふくらはぎが伸びる */}
          <path d="M88 98 L70 120" {...LIMB} />
          <path d="M70 120 L50 142" {...HILITE} />
          <path d="M88 98 L80 58" {...TORSO} />
          <Head cx={76} cy={45} />
          {/* 壁についた腕 */}
          <path d="M80 60 L140 72 L198 64" {...LIMB} />
        </>
      );

    case 'stretch-quad':
      return (
        <>
          <Ground />
          {/* 支え脚 */}
          <path d="M112 94 L120 118 L122 142" {...LIMB} />
          {/* 曲げた脚：前ももが伸びる。膝は体の真下のまま */}
          <path d="M112 94 L100 124" {...HILITE} />
          {/* すねは後ろ上へ。かかとがお尻に近づく */}
          <path d="M100 124 L74 100" {...LIMB} />
          <path d="M112 94 L114 50" {...TORSO} />
          <Head cx={115} cy={37} />
          {/* 足首をつかむ腕 */}
          <path d="M114 52 L94 74 L76 97" {...LIMB} />
        </>
      );

    case 'stretch-glute':
      return (
        <>
          <Ground />
          {/* 床についた頭と肩 */}
          <Head cx={38} cy={132} r={10} />
          <path d="M46 134 L66 138" {...LIMB} />
          {/* 背中は床につけたまま */}
          <path d="M66 138 L120 138" {...TORSO} />
          {/* 伸ばしたままの脚 */}
          <path d="M120 138 L160 140 L196 138" {...LIMB} />
          {/* 抱えた脚：お尻の奥が伸びる */}
          <path d="M120 138 L106 92" {...HILITE} />
          <path d="M106 92 L142 104" {...LIMB} />
          {/* 膝を抱える腕 */}
          <path d="M66 138 L84 114 L104 94" {...LIMB} />
        </>
      );

    case 'stretch-iliopsoas':
      return (
        <>
          <Ground />
          {/* 前脚：膝90度 */}
          <path d="M102 96 L140 116 L142 142" {...LIMB} />
          {/* 後ろ脚：股関節の前が伸びる */}
          <path d="M102 96 L76 138" {...HILITE} />
          <path d="M76 138 L44 132" {...LIMB} />
          <path d="M102 96 L100 52" {...TORSO} />
          <Head cx={100} cy={39} />
          {/* 前膝に置いた手 */}
          <path d="M100 54 L124 88 L138 112" {...LIMB} />
        </>
      );

    // --- 走り方 ---
    case 'form-overstride':
      return (
        <>
          <Ground />
          <Cross x={22} y={18} />
          <Check x={146} y={18} />

          {/* 左：重心より前で接地している */}
          <line x1="58" y1="44" x2="58" y2="142" {...GUIDE} stroke="currentColor" opacity={0.4} />
          <path d="M58 86 L44 110 L32 128" {...LIMB} />
          <path d="M58 86 L82 104 L102 140" {...HILITE} />
          <path d="M58 86 L58 46" {...TORSO} />
          <Head cx={58} cy={34} r={10} />
          <path d="M58 50 L42 72" {...LIMB} />

          {/* 右：重心のほぼ真下で接地している */}
          <line x1="178" y1="44" x2="178" y2="142" {...GUIDE} stroke="currentColor" opacity={0.4} />
          <path d="M178 86 L162 104 L150 118" {...LIMB} />
          <path d="M178 86 L188 112 L182 140" {...HILITE} />
          <path d="M178 86 L178 46" {...TORSO} />
          <Head cx={178} cy={34} r={10} />
          <path d="M178 50 L162 72" {...LIMB} />
        </>
      );

    case 'form-cadence':
      return (
        <>
          {/* 両端の基準。上下とも同じ距離を走っていることを示す */}
          <line x1="24" y1="22" x2="24" y2="146" {...PROP} />
          <line x1="216" y1="22" x2="216" y2="146" {...PROP} />
          {/* 進む向きの線 */}
          <line x1="24" y1="56" x2="216" y2="56" {...PROP} strokeWidth={2} />
          <line x1="24" y1="116" x2="216" y2="116" {...PROP} strokeWidth={2} />

          {/* 上：歩数が少なく、1歩が大きい */}
          <g fill="currentColor" opacity={0.5}>
            {[38, 94, 150, 206].map((x, i) => (
              <ellipse key={x} cx={x} cy={i % 2 === 0 ? 44 : 68} rx={6} ry={10} />
            ))}
          </g>

          {/* 下：同じ距離を、小さく多く刻む */}
          <g fill="var(--accent)">
            {[38, 62, 86, 110, 134, 158, 182, 206].map((x, i) => (
              <ellipse key={x} cx={x} cy={i % 2 === 0 ? 104 : 128} rx={6} ry={10} />
            ))}
          </g>
        </>
      );

    case 'form-posture':
      return (
        <>
          <Ground />
          <Cross x={22} y={18} />
          <Check x={146} y={18} />

          {/* 左：腰から折れている */}
          <path d="M48 30 L68 92 L66 140" {...GUIDE} stroke="var(--warn)" />
          <path d="M66 92 L52 116 L46 140" {...LIMB} />
          <path d="M66 92 L80 116 L88 140" {...LIMB} />
          <path d="M66 92 L46 54" {...TORSO} />
          <Head cx={40} cy={42} r={10} />
          <path d="M46 56 L64 74" {...LIMB} />

          {/* 右：耳・肩・腰・くるぶしが一直線 */}
          <path d="M170 28 L188 140" {...GUIDE} stroke="var(--good)" />
          <path d="M180 92 L168 116 L164 140" {...LIMB} />
          <path d="M180 92 L194 116 L198 140" {...LIMB} />
          <path d="M180 92 L174 50" {...TORSO} />
          <Head cx={172} cy={38} r={10} />
          <path d="M174 52 L190 72" {...LIMB} />
        </>
      );

    case 'form-armswing':
      return (
        <>
          <Ground />
          <path d="M110 104 L96 124 L88 142" {...LIMB} />
          <path d="M110 104 L128 122 L140 142" {...LIMB} />
          <path d="M110 104 L114 56" {...TORSO} />
          <Head cx={115} cy={43} />
          {/* 前に出ている側（引いた反動で出る） */}
          <g opacity={0.35}>
            <path d="M114 58 L134 80 L122 62" {...LIMB} />
          </g>
          {/* 後ろへ引く側。肘は約90度 */}
          <path d="M114 58 L94 82 L108 98" {...HILITE} />
          {/* 肘が描く弧 */}
          <path d="M126 66 A 30 30 0 0 0 98 92" {...GUIDE} />
        </>
      );

    // --- 補強 ---
    case 'strength-plank':
      return (
        <>
          <Ground />
          {/* まっすぐであることの基準 */}
          <path d="M64 104 L204 140" {...GUIDE} />
          {/* 前腕で支える */}
          <path d="M78 112 L80 142" {...LIMB} />
          <path d="M80 142 L52 142" {...LIMB} />
          {/* 体幹：ここを保つ */}
          <path d="M78 112 L140 124" {...HILITE_TORSO} />
          <path d="M140 124 L172 131 L204 140" {...LIMB} />
          <Head cx={62} cy={106} r={10} />
        </>
      );

    case 'strength-calf-raise':
      return (
        <>
          {/* 段差。足の前半分だけを乗せ、かかとは手前にはみ出す */}
          <rect x="108" y="108" width="112" height="34" fill="currentColor" opacity={0.1} />
          <path d="M108 108 L220 108" {...PROP} strokeWidth={4} />
          <path d="M108 108 L108 142" {...PROP} strokeWidth={4} />
          <Ground to={108} />
          {/* もも */}
          <path d="M132 24 L130 72" {...LIMB} />
          {/* すね：ふくらはぎが働く */}
          <path d="M130 72 L128 106" {...HILITE} />
          {/* 足の前半分は段差の上 */}
          <path d="M128 106 L154 108" {...LIMB} />
          {/* 上げたかかと */}
          <path d="M128 106 L104 96" {...LIMB} />
          {/* かかとが動く向き */}
          <path d="M92 126 L92 104" {...GUIDE} />
          <path d="M87 110 L92 102 L97 110" {...GUIDE} strokeDasharray="0" />
        </>
      );

    case 'strength-hip-lift':
      return (
        <>
          <Ground />
          {/* 肩から膝までが一直線になる高さまで上げる */}
          <path d="M62 136 L118 106 L154 100" {...GUIDE} />
          {/* 首から肩。頭は床につけたまま */}
          <path d="M46 134 L62 136" {...LIMB} />
          <Head cx={38} cy={132} r={10} />
          {/* 背中 */}
          <path d="M62 136 L98 118" {...LIMB} />
          {/* お尻：ここを締めて持ち上げる */}
          <path d="M98 118 L118 106" {...HILITE_TORSO} />
          {/* もも・すね */}
          <path d="M118 106 L154 100 L160 142" {...LIMB} />
          {/* 床についた腕 */}
          <path d="M64 138 L90 142" {...LIMB} />
        </>
      );

    case 'strength-single-leg-squat':
      return (
        <>
          <Ground />
          {/* 膝が足の上に来ているかの基準 */}
          <line x1="122" y1="88" x2="124" y2="142" {...GUIDE} />
          {/* 浮かせた脚 */}
          <path d="M120 88 L102 110 L96 126" {...LIMB} />
          {/* 立っている脚：向きを保つ */}
          <path d="M120 88 L127 114 L124 142" {...HILITE} />
          <path d="M120 88 L120 46" {...TORSO} />
          <Head cx={120} cy={33} />
          {/* バランスを取る腕 */}
          <path d="M120 50 L94 66" {...LIMB} />
          <path d="M120 50 L146 66" {...LIMB} />
        </>
      );

    default:
      return null;
  }
}
