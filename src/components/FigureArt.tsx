/**
 * 説明図の絵。
 *
 * 全て手で描いている。その場で生成させると、指が6本あったり膝が逆に曲がったりして、
 * それを見て真似た人が故障する。お手本の絵は間違ってはいけない。
 *
 * **棒人間をやめた。** 線だけだと、胴も顔の向きも足も無いので、
 * 「人が何をしているのか」がそもそも読めなかった。
 * 子どもが見ても分かる図にするために、この5つを入れている。
 *
 *  1. **体がある**（胴は太く、頭には鼻、足は地面に着く）
 *  2. **奥の手足は薄く**。どちらの脚の話かが一目で分かる
 *  3. **伸びる場所は色の面**で示す。線を太くするだけでは「そこが伸びる」と読めない
 *  4. **動く向きは矢印**で示す。静止画では「上げる」が伝わらない
 *  5. **図の中に短い言葉**を置く。ひらがな多め、指し示す線つき
 *
 * 5 は以前あえて入れなかったが、それは間違いだった。
 * カードの下に文章があっても、**絵と目が合った瞬間に分からなければ図の意味がない。**
 */

export const FIGURE_VIEWBOX = '0 0 260 190';

/** 地面の高さ。全部の図でここに立たせる。 */
const G = 166;

type P = readonly [number, number];

/** 奥側の手足。薄くして、手前と見分ける。 */
const FAR_OPACITY = 0.3;

function path(points: readonly P[]): string {
  return points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
}

/**
 * 節ごとに太さの変わる肉づけ。
 *
 * **同じ太さの線は、どうやっても棒にしか見えない。**
 * 人の脚は太ももが太くて足首が細い。その差があるだけで、
 * 「棒」ではなく「脚」として読めるようになる。
 * 関節には丸を置いて、節の継ぎ目が角張らないようにする。
 */
function Flesh({
  points,
  from,
  to,
  far = false,
}: {
  points: readonly P[];
  /** 付け根の太さ。 */
  from: number;
  /** 先の太さ。 */
  to: number;
  far?: boolean;
}) {
  // 付け根からの道のりで太さを配る。節の長さが違っても、先細りが自然に見える。
  const run = [0];
  for (let i = 1; i < points.length; i += 1) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    run.push(run[i - 1] + Math.hypot(bx - ax, by - ay));
  }
  const total = run[run.length - 1] || 1;
  const widths = run.map((length) => from + (to - from) * (length / total));

  return (
    <g fill="currentColor" opacity={far ? FAR_OPACITY : 1}>
      {points.slice(1).map((point, index) => {
        const [ax, ay] = points[index];
        const [bx, by] = point;
        const length = Math.hypot(bx - ax, by - ay) || 1;
        // 進む向きに垂直な方向へ、太さの半分だけ広げる。
        const nx = -(by - ay) / length;
        const ny = (bx - ax) / length;
        const ha = widths[index] / 2;
        const hb = widths[index + 1] / 2;
        return (
          <path
            key={`${bx},${by}`}
            d={`M${ax + nx * ha} ${ay + ny * ha} L${bx + nx * hb} ${by + ny * hb} L${bx - nx * hb} ${by - ny * hb} L${ax - nx * ha} ${ay - ny * ha} Z`}
          />
        );
      })}
      {points.map((point, index) => (
        <circle key={`${point[0]},${point[1]}`} cx={point[0]} cy={point[1]} r={widths[index] / 2} />
      ))}
    </g>
  );
}

/** 手足。付け根を太く、先を細く。 */
function Limb({
  points,
  far = false,
  width = 13,
}: {
  points: readonly P[];
  far?: boolean;
  width?: number;
}) {
  // 先細りは控えめに。落としすぎると、腕が糸のように見える。
  return <Flesh points={points} from={width} to={width * 0.72} far={far} />;
}

/**
 * 胴。
 * **肩幅を持たせる。** 首から腰まで同じ太さだと、体ではなく1本の柱に見える。
 * 首の分だけ上へ伸ばしておくと、頭が胴に埋まらない。
 */
function Torso({
  neck,
  hip,
  width = 23,
  shoulders = 30,
}: {
  neck: P;
  hip: P;
  width?: number;
  shoulders?: number;
}) {
  const [nx, ny] = neck;
  const [hx, hy] = hip;
  const length = Math.hypot(hx - nx, hy - ny) || 1;
  // 首は、腰と逆の向きへ少しだけ伸ばす。
  const up: P = [nx - ((hx - nx) / length) * 7, ny - ((hy - ny) / length) * 7];

  return (
    <g>
      <Flesh points={[up, neck]} from={12} to={shoulders} />
      <Flesh points={[neck, hip]} from={shoulders} to={width} />
    </g>
  );
}

/**
 * 頭。
 * **鼻をつけるかどうかで、図の読みやすさが変わる。**
 * どちらを向いているか分からない人物は、何をしているかも分からない。
 */
function Head({ at, angle = 0, r = 13 }: { at: P; angle?: number; r?: number }) {
  const [x, y] = at;
  // 顔の面。**塗りつぶしの丸のままでは、頭ではなく球に見える。**
  // 前寄りを明るく抜くと、暗いほうが髪、明るいほうが顔として読める。
  //
  // 鼻は付けない。面で向きが分かるところに出っぱりを足すと、
  // **横顔ではなく、くちばしに見える。**
  const face = r - 2.5;
  const chord = -face * 0.38;
  const half = Math.sqrt(Math.max(face * face - chord * chord, 0));

  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`}>
      <circle cx={0} cy={0} r={r} fill="currentColor" />
      <path
        // 大きいほうの弧を取る（0 にすると、顔ではなく後頭部側の細い月型になる）。
        d={`M${chord} ${-half} A${face} ${face} 0 1 1 ${chord} ${half} Z`}
        fill="var(--bg-sunken)"
      />
      {/* 目。1つで足りる。横を向いているので、もう片方は見えない。 */}
      <circle cx={face * 0.38} cy={-1.5} r={1.9} fill="currentColor" />
    </g>
  );
}

/** 正面を向いた頭。目があるだけで「こちらを向いている」と分かる。 */
function FrontHead({ at, r = 13 }: { at: P; r?: number }) {
  const [x, y] = at;
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill="currentColor" />
      {/* 顔の面を抜く。上に残った帯が髪に見える。 */}
      <circle cx={x} cy={y + 2.5} r={r - 2.5} fill="var(--bg-sunken)" />
      <circle cx={x - 4.5} cy={y + 1} r={2} fill="currentColor" />
      <circle cx={x + 4.5} cy={y + 1} r={2} fill="currentColor" />
    </g>
  );
}

/** 足。地面に着いていることを示す。足が無いと、立っているのか浮いているのか分からない。 */
function Foot({ from, to, far = false }: { from: P; to: P; far?: boolean }) {
  // かかとが太く、つま先が細い。靴の形に近づけると、地面に着いているのが分かる。
  return <Flesh points={[from, to]} from={10} to={6} far={far} />;
}

/** 伸びている場所・効いている場所。線ではなく面で示す。 */
function Spot({
  at,
  rx = 17,
  ry = 12,
  angle = 0,
}: {
  at: P;
  rx?: number;
  ry?: number;
  angle?: number;
}) {
  const [x, y] = at;
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`}>
      <ellipse rx={rx} ry={ry} fill="var(--accent)" opacity={0.22} />
      <ellipse rx={rx} ry={ry} fill="none" stroke="var(--accent)" strokeWidth={2} opacity={0.55} />
    </g>
  );
}

/** 動く向き。まっすぐでも曲がっていても、先は必ず三角で閉じる。 */
function Arrow({ from, to, bend = 0 }: { from: P; to: P; bend?: number }) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  // 曲げる時は、線の垂直方向へ制御点をずらす。
  const cx = mx - (dy / length) * bend;
  const cy = my + (dx / length) * bend;
  // 矢じりの向きは、終点へ入ってくる向きに合わせる。
  const ix = x2 - (bend === 0 ? x1 : cx);
  const iy = y2 - (bend === 0 ? y1 : cy);
  const angle = (Math.atan2(iy, ix) * 180) / Math.PI;

  return (
    <g stroke="var(--accent)" fill="var(--accent)">
      <path
        d={bend === 0 ? `M${x1} ${y1} L${x2} ${y2}` : `M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}`}
        fill="none"
        strokeWidth={3}
        strokeLinecap="round"
      />
      <g transform={`translate(${x2} ${y2}) rotate(${angle})`}>
        <path d="M0 0 L-9 -5 L-9 5 Z" stroke="none" />
      </g>
    </g>
  );
}

type Tone = 'accent' | 'good' | 'warn' | 'muted';

const TONE_COLOR: Record<Tone, string> = {
  accent: 'var(--accent)',
  good: 'var(--good)',
  warn: 'var(--warn)',
  muted: 'var(--fg-muted)',
};

/**
 * 図の中の言葉。
 * ひらがな多め、短く。指し示す先があるなら細い線でつなぐ。
 */
function Note({
  at,
  text,
  to,
  tone = 'accent',
  anchor = 'start',
}: {
  at: P;
  text: string;
  to?: P;
  tone?: Tone;
  anchor?: 'start' | 'middle' | 'end';
}) {
  const [x, y] = at;
  const color = TONE_COLOR[tone];
  return (
    <g>
      {to && (
        <path
          d={path([at, to])}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeDasharray="3 3"
          opacity={0.7}
        />
      )}
      <text x={x} y={y} fontSize={12} fontWeight={700} fill={color} textAnchor={anchor}>
        {text}
      </text>
    </g>
  );
}

/** まっすぐであってほしい線。 */
function Guide({ from, to, tone = 'accent' }: { from: P; to: P; tone?: Tone }) {
  return (
    <path
      d={path([from, to])}
      fill="none"
      stroke={TONE_COLOR[tone]}
      strokeWidth={2}
      strokeDasharray="6 5"
      strokeLinecap="round"
      opacity={0.75}
    />
  );
}

/** 床・壁・段差。体ではないものは、薄い面で置く。 */
function Ground({ y = G, from = 10, to = 250 }: { y?: number; from?: number; to?: number }) {
  return <line x1={from} y1={y} x2={to} y2={y} stroke="currentColor" strokeWidth={3} opacity={0.25} strokeLinecap="round" />;
}

function Block({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <g opacity={0.22}>
      <rect x={x} y={y} width={w} height={h} rx={3} fill="currentColor" />
    </g>
  );
}

/** 良い例の印。 */
function Check({ at }: { at: P }) {
  const [x, y] = at;
  return (
    <path
      d={`M${x} ${y + 5} l5 6 l12 -14`}
      fill="none"
      stroke="var(--good)"
      strokeWidth={4.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

/** 避けたい例の印。 */
function Cross({ at }: { at: P }) {
  const [x, y] = at;
  return (
    <g fill="none" stroke="var(--warn)" strokeWidth={4.5} strokeLinecap="round">
      <path d={`M${x} ${y} l13 13`} />
      <path d={`M${x + 13} ${y} l-13 13`} />
    </g>
  );
}

/** 足あと。歩幅と歩数は、足あとで見せるのがいちばん早い。 */
function Footprint({ at, tone = 'muted' }: { at: P; tone?: Tone }) {
  const [x, y] = at;
  return (
    <g fill={TONE_COLOR[tone]} opacity={tone === 'muted' ? 0.45 : 0.85}>
      <ellipse cx={x} cy={y} rx={4.5} ry={7} />
      <ellipse cx={x} cy={y + 9} rx={3.5} ry={3} />
    </g>
  );
}

/** 走っている人。小さく置いて、足あとの主を示す。 */
function MiniRunner({ at, scale = 1 }: { at: P; scale?: number }) {
  const [x, y] = at;
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} opacity={0.85}>
      <Torso neck={[0, -30]} hip={[2, -2]} width={13} />
      <Limb points={[[0, -26], [12, -14], [4, -4]]} width={6} />
      <Limb points={[[2, -2], [16, 12], [26, 24]]} width={6} />
      <Limb points={[[2, -2], [-10, 10], [-6, 24]]} width={6} far />
      <Head at={[-2, -40]} r={9} />
    </g>
  );
}

/** 図ごとの絵。id が無ければ null を返し、画面には何も出さない。 */
export function figureArt(id: string): React.ReactNode {
  switch (id) {
    // --- ストレッチ ---
    case 'stretch-hamstring':
      return (
        <g>
          <Ground />
          {/* 後ろ脚（奥） */}
          <Limb points={[[140, 100], [126, 134], [118, 162]]} far />
          <Foot from={[118, 164]} to={[136, 166]} far />
          {/* 胴：股関節から前に倒す */}
          <Torso neck={[176, 76]} hip={[140, 100]} />
          {/* 前脚（手前）：かかとだけ地面、つま先は上 */}
          <Limb points={[[140, 100], [176, 132], [200, 162]]} />
          <Foot from={[200, 163]} to={[214, 148]} />
          {/* 腕：前ももに手を置く */}
          <Limb points={[[174, 82], [194, 104], [180, 124]]} width={8} />
          <Head at={[190, 64]} angle={35} />
          <Spot at={[160, 118]} rx={20} ry={11} angle={42} />
          <Guide from={[136, 104]} to={[196, 62]} tone="good" />
          <Note at={[16, 150]} text="ここが のびる" to={[146, 122]} />
          <Note at={[112, 34]} text="せなかは まっすぐ" to={[166, 82]} tone="good" />
          <Note at={[210, 182]} text="つまさき 上" to={[212, 152]} anchor="middle" />
        </g>
      );

    case 'stretch-calf':
      return (
        <g>
          <Ground />
          {/* 壁 */}
          <Block x={236} y={26} w={10} h={140} />
          {/* 前脚（奥）：膝を曲げる */}
          <Limb points={[[138, 104], [178, 126], [186, 158]]} far />
          <Foot from={[180, 165]} to={[202, 165]} far />
          <Torso neck={[148, 74]} hip={[134, 104]} />
          {/* 後ろ脚（手前）：まっすぐ、かかとは床 */}
          <Limb points={[[134, 104], [114, 132], [98, 158]]} />
          <Foot from={[90, 165]} to={[114, 165]} />
          {/* 腕：壁に手をつく */}
          <Limb points={[[150, 78], [190, 76], [232, 80]]} width={8} />
          <Head at={[158, 58]} angle={10} />
          <Spot at={[104, 144]} rx={11} ry={17} angle={-28} />
          <Arrow from={[74, 150]} to={[86, 162]} />
          <Note at={[14, 140]} text="ここが のびる" to={[96, 144]} />
          <Note at={[30, 182]} text="かかとは つけたまま" />
        </g>
      );

    case 'stretch-quad':
      return (
        <g>
          <Ground />
          {/* 左を向かせる。右向きだと、持った足が胴に重なって形が読めない。 */}
          <Limb points={[[122, 100], [120, 132], [118, 160]]} far />
          <Foot from={[118, 165]} to={[98, 166]} far />
          <Torso neck={[128, 62]} hip={[130, 100]} />
          {/* 伸ばす脚（手前）：かかとをお尻へ */}
          <Limb points={[[136, 100], [142, 134], [162, 114]]} />
          <Foot from={[162, 114]} to={[172, 104]} />
          {/* 腕：後ろで足首を持つ */}
          <Limb points={[[132, 66], [150, 92], [162, 112]]} width={8} />
          <Head at={[126, 44]} angle={180} />
          <Spot at={[136, 117]} rx={9} ry={16} angle={-8} />
          <Arrow from={[142, 148]} to={[142, 162]} />
          <Note at={[104, 36]} text="ここが のびる" to={[132, 106]} anchor="end" />
          <Note at={[180, 182]} text="ひざは 下へ" anchor="middle" />
        </g>
      );

    case 'stretch-glute':
      return (
        <g>
          <Ground />
          {/* 伸ばしたままの脚（奥） */}
          <Limb points={[[150, 154], [186, 158], [216, 160]]} far />
          <Foot from={[216, 160]} to={[222, 148]} far />
          <Torso neck={[84, 150]} hip={[150, 154]} />
          {/* 抱える脚（手前）：ひざを反対の肩へ */}
          <Limb points={[[150, 154], [122, 114], [156, 128]]} />
          <Foot from={[156, 128]} to={[168, 136]} />
          {/* 両腕ですねを抱える。太ももと重ねると、黒い塊になって読めない。 */}
          <Limb points={[[94, 146], [106, 124], [138, 118]]} width={8} />
          <Limb points={[[94, 152], [114, 134], [142, 126]]} width={8} far />
          <Head at={[60, 146]} angle={-70} />
          <Spot at={[152, 144]} rx={15} ry={11} angle={-10} />
          <Arrow from={[122, 96]} to={[98, 110]} bend={8} />
          <Note at={[178, 182]} text="おしりが のびる" to={[158, 152]} anchor="middle" />
          <Note at={[118, 78]} text="ひざは 反対の かたへ" tone="good" anchor="middle" />
        </g>
      );

    case 'stretch-iliopsoas':
      return (
        <g>
          <Ground />
          {/* 前脚（奥）：ひざ90度 */}
          <Limb points={[[146, 104], [188, 128], [190, 158]]} far />
          <Foot from={[184, 165]} to={[206, 165]} far />
          {/* 後ろ脚（手前）：ひざを床に */}
          <Limb points={[[140, 104], [114, 156], [86, 162]]} />
          <Foot from={[86, 162]} to={[74, 156]} />
          <Torso neck={[142, 66]} hip={[140, 104]} />
          <Limb points={[[146, 70], [168, 96], [188, 122]]} width={8} />
          <Head at={[142, 48]} />
          <Spot at={[146, 112]} rx={15} ry={11} angle={-20} />
          <Arrow from={[108, 92]} to={[136, 92]} />
          <Note at={[250, 92]} text="ここが のびる" to={[160, 110]} anchor="end" />
          <Note at={[30, 86]} text="こしを 前へ" />
          <Note at={[52, 182]} text="ひざは 床に" to={[110, 158]} />
        </g>
      );

    // --- 走り方 ---
    case 'form-overstride':
      return (
        <g>
          <Ground />
          <Cross at={[18, 22]} />
          {/* 悪い例：足が体の前に着く */}
          <Limb points={[[54, 98], [40, 128], [34, 156]]} far />
          <Foot from={[30, 164]} to={[48, 166]} far />
          <Torso neck={[58, 62]} hip={[54, 98]} />
          <Limb points={[[54, 98], [82, 122], [100, 160]]} />
          <Foot from={[98, 163]} to={[114, 158]} />
          <Limb points={[[58, 66], [40, 88], [46, 108]]} width={8} />
          <Head at={[60, 44]} />
          <Guide from={[54, 98]} to={[54, 166]} tone="warn" />
          <Note at={[64, 182]} text="足が 前すぎる" tone="warn" anchor="middle" />

          <Check at={[160, 22]} />
          {/* 良い例：足は体の真下 */}
          <Limb points={[[196, 98], [180, 126], [176, 154]]} far />
          <Foot from={[172, 164]} to={[190, 166]} far />
          <Torso neck={[200, 62]} hip={[196, 98]} />
          <Limb points={[[196, 98], [206, 128], [200, 158]]} />
          <Foot from={[198, 163]} to={[214, 160]} />
          <Limb points={[[200, 66], [182, 88], [188, 108]]} width={8} />
          <Head at={[202, 44]} />
          <Guide from={[196, 98]} to={[196, 166]} tone="good" />
          <Note at={[206, 182]} text="からだの 下" tone="good" anchor="middle" />
        </g>
      );

    case 'form-cadence':
      return (
        <g>
          {/* 上：1歩が大きい */}
          <MiniRunner at={[34, 62]} scale={0.85} />
          {[86, 132, 178, 224].map((x, index) => (
            <Footprint key={x} at={[x, index % 2 === 0 ? 46 : 58]} />
          ))}
          <Note at={[86, 28]} text="歩はばが 大きい" tone="muted" />

          {/* 下：小さく たくさん */}
          <MiniRunner at={[34, 158]} scale={0.85} />
          {[80, 104, 128, 152, 176, 200, 224].map((x, index) => (
            <Footprint key={x} at={[x, index % 2 === 0 ? 142 : 154]} tone="accent" />
          ))}
          <Check at={[82, 172]} />
          <Note at={[102, 184]} text="小さく たくさん 180ぽ／分" />
        </g>
      );

    case 'form-posture':
      return (
        <g>
          <Ground />
          <Cross at={[18, 22]} />
          {/* 悪い例：腰から折れている */}
          <Limb points={[[56, 104], [42, 132], [40, 160]]} far />
          <Foot from={[36, 165]} to={[54, 166]} far />
          <Torso neck={[86, 82]} hip={[56, 104]} />
          <Limb points={[[56, 104], [76, 132], [86, 160]]} />
          <Foot from={[84, 165]} to={[102, 166]} />
          <Limb points={[[86, 86], [72, 108], [82, 122]]} width={8} />
          <Head at={[98, 70]} angle={28} />
          <Guide from={[56, 166]} to={[56, 104]} tone="warn" />
          <Guide from={[56, 104]} to={[94, 76]} tone="warn" />
          <Note at={[60, 182]} text="こしで 折れている" tone="warn" anchor="middle" />

          <Check at={[160, 22]} />
          {/* 良い例：くるぶしから頭まで一直線 */}
          <Limb points={[[192, 100], [178, 128], [174, 158]]} far />
          <Foot from={[170, 165]} to={[188, 166]} far />
          <Torso neck={[200, 64]} hip={[192, 100]} />
          <Limb points={[[192, 100], [202, 130], [198, 160]]} />
          <Foot from={[196, 165]} to={[212, 164]} />
          <Limb points={[[200, 68], [184, 90], [194, 106]]} width={8} />
          <Head at={[204, 46]} />
          <Guide from={[186, 166]} to={[206, 44]} tone="good" />
          <Note at={[206, 182]} text="ひとつの 線" tone="good" anchor="middle" />
        </g>
      );

    case 'form-armswing':
      return (
        <g>
          <Ground />
          <Limb points={[[128, 104], [112, 132], [106, 160]]} far />
          <Foot from={[102, 165]} to={[120, 166]} far />
          <Torso neck={[132, 64]} hip={[128, 104]} />
          <Limb points={[[128, 104], [150, 130], [156, 160]]} />
          <Foot from={[154, 165]} to={[172, 166]} />
          {/* 後ろへ引いた腕（奥） */}
          <Limb points={[[126, 68], [104, 88], [86, 74]]} width={8} far />
          {/* 前に出た腕（手前）：ひじ90度 */}
          <Limb points={[[134, 68], [150, 94], [178, 84]]} width={8} />
          <Head at={[134, 46]} />
          <Spot at={[150, 94]} rx={11} ry={11} />
          <Arrow from={[108, 62]} to={[82, 60]} />
          <Note at={[250, 74]} text="ひじ 90ど" to={[160, 92]} anchor="end" />
          <Note at={[14, 44]} text="うしろへ ひく" />
        </g>
      );

    // --- 補強 ---
    case 'strength-plank':
      return (
        <g>
          <Ground />
          {/* 奥の腕と脚 */}
          <Limb points={[[110, 124], [112, 156], [88, 163]]} width={8} far />
          <Limb points={[[164, 140], [198, 152], [222, 162]]} far />
          {/* 体：頭からかかとまで一直線 */}
          <Torso neck={[110, 120]} hip={[164, 138]} />
          <Limb points={[[164, 138], [200, 150], [226, 160]]} />
          <Foot from={[226, 160]} to={[232, 166]} />
          {/* 手前の腕：ひじは肩の真下 */}
          <Limb points={[[106, 120], [104, 156], [78, 162]]} width={8} />
          <Head at={[92, 112]} angle={155} />
          <Spot at={[144, 134]} rx={18} ry={11} angle={16} />
          <Guide from={[86, 108]} to={[232, 162]} tone="good" />
          <Guide from={[104, 122]} to={[104, 154]} tone="warn" />
          <Note at={[120, 182]} text="ひじは かたの 真下" tone="warn" to={[106, 158]} />
          <Note at={[150, 100]} text="あたまから かかとまで 一直線" tone="good" anchor="middle" />
          <Note at={[248, 116]} text="おなかに 力" to={[160, 132]} anchor="end" />
        </g>
      );

    case 'strength-calf-raise':
      return (
        <g>
          <Ground />
          {/* 段差 */}
          <Block x={150} y={140} w={98} h={26} />
          {/* 奥の脚 */}
          <Limb points={[[152, 78], [150, 110], [152, 136]]} far />
          <Torso neck={[148, 46]} hip={[150, 78]} />
          <Limb points={[[150, 78], [154, 108], [158, 136]]} />
          {/* 足：前半分だけ段差に乗せる */}
          <Foot from={[158, 138]} to={[180, 139]} />
          <Limb points={[[148, 50], [122, 66], [104, 74]]} width={8} />
          <Limb points={[[150, 50], [176, 66], [192, 72]]} width={8} far />
          <Head at={[146, 28]} />
          <Spot at={[156, 118]} rx={11} ry={16} />
          {/* 下げた位置（点線）と、上げる向き */}
          <path
            d="M140 156 L158 150"
            fill="none"
            stroke="var(--warn)"
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray="5 4"
            opacity={0.8}
          />
          <Arrow from={[128, 156]} to={[128, 124]} />
          <Note at={[92, 124]} text="3びょうで 上げる" anchor="middle" />
          <Note at={[64, 176]} text="かかとは 段から 出す" tone="warn" to={[138, 156]} />
          <Note at={[250, 92]} text="足の 前半分を のせる" to={[176, 138]} anchor="end" />
        </g>
      );

    case 'strength-hip-lift':
      return (
        <g>
          <Ground />
          {/* 奥の脚 */}
          <Limb points={[[150, 132], [196, 122], [202, 160]]} far />
          <Foot from={[196, 165]} to={[218, 165]} far />
          {/* 体：肩は床に置いたまま、腰だけを持ち上げる */}
          <Torso neck={[80, 156]} hip={[152, 126]} />
          <Limb points={[[152, 126], [202, 116], [208, 158]]} />
          <Foot from={[202, 165]} to={[226, 165]} />
          {/* 腕は床。胴と重ならないよう、下へ離して置く。 */}
          <Limb points={[[84, 160], [112, 166], [138, 167]]} width={8} />
          <Head at={[56, 150]} angle={-70} />
          <Spot at={[150, 138]} rx={15} ry={11} angle={-14} />
          <Guide from={[76, 158]} to={[202, 116]} tone="good" />
          {/* 下ろした位置。ここからどれだけ上げるのかを示す。 */}
          <path
            d="M110 160 L148 157"
            fill="none"
            stroke="var(--warn)"
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray="5 4"
            opacity={0.55}
          />
          <Arrow from={[150, 154]} to={[150, 132]} />
          <Note at={[132, 34]} text="おしりを しめて 上げる" anchor="middle" />
          <Note at={[248, 76]} text="かた・こし・ひざが 一直線" tone="good" anchor="end" />
        </g>
      );

    case 'strength-single-leg-squat':
      return (
        <g>
          <Ground />
          {/* 正面から見た図。ひざの向きは、横からでは分からない。 */}
          <Limb points={[[118, 70], [96, 96], [90, 120]]} width={8} />
          <Limb points={[[142, 70], [164, 96], [170, 120]]} width={8} />
          <Torso neck={[130, 70]} hip={[130, 108]} width={24} />
          {/* 浮かせた脚（奥） */}
          <Limb points={[[120, 108], [106, 128], [96, 142]]} far />
          <Foot from={[90, 146]} to={[106, 148]} far />
          {/* 内に入った悪い例。すねまで描くと良い脚と交差して混み合うので、ももだけ。 */}
          <g opacity={0.28}>
            <Limb points={[[140, 108], [116, 140]]} />
          </g>
          <Cross at={[94, 132]} />
          {/* 立っている脚（手前）：ひざはつま先の上 */}
          <Limb points={[[140, 108], [152, 138], [150, 162]]} />
          <Foot from={[138, 166]} to={[164, 166]} />
          <FrontHead at={[130, 44]} />
          <Guide from={[152, 134]} to={[150, 164]} tone="good" />
          <Check at={[172, 132]} />
          <Note at={[250, 32]} text="ひざは つまさきの 上" tone="good" to={[156, 138]} anchor="end" />
          <Note at={[10, 116]} text="内に 入れない" tone="warn" to={[116, 138]} />
        </g>
      );

    default:
      return null;
  }
}
