'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LM } from '@/lib/exercise';
import { analyzeGait, describeGait, type Contact, type Frame, type GaitReport } from '@/lib/gait';
import { LEG_BONES, bodyBox, drawSkeleton, inBox, loadPoseForFrames } from '@/lib/pose';
import Sheet from './Sheet';

/**
 * 数秒の動画から、走りを数字にする画面。
 *
 * **動画は端末から出ない。** 1コマずつ読んで数字にするところまで、全部ここで終わる。
 * コーチへ渡すのは測った数字だけで、映像そのものは送らない。
 *
 * 作りの方針:
 *  - **測るだけ。良し悪しはコーチが言う。** 接地の位置も体幹の角度も、
 *    速度と体の作りで変わる。ここで「良い/悪い」を出すと、
 *    その人にとって正しい動きを直させることになる
 *  - 測れなかった時は、黙って0を出さない。理由を出して撮り直してもらう
 *  - **絵と数字を一致させる。** 「接地位置 4%」と出すなら、その4%が絵の上に
 *    幅として引かれていないと、何を言われているのか分からない
 */

/** 何秒ぶん見るか。長く撮られても、この長さだけ使う。 */
const CLIP_SECONDS = 4;

/**
 * 1秒あたり何コマ読むか。
 * **1コマごとに姿勢推定が走るので、ここが待ち時間そのもの。**
 * 一歩は0.35秒前後なので、20コマ/秒あれば接地の瞬間を取り違えない。
 */
const SAMPLE_FPS = 20;

/** 読むコマ数の上限。端末が古いと、ここが時間に直結する。 */
const MAX_FRAMES = CLIP_SECONDS * SAMPLE_FPS;

/**
 * 見せる絵の大きさ。
 * **画面の全部は出さない。** 体のまわりだけを切り出して、この大きさに伸ばす。
 * 引きで撮った動画をそのまま出すと、人が小指の先ほどになって何も読めない。
 */
const SHOT_W = 720;
const SHOT_H = 800;

/** ふつうの骨の色と、着いている脚・測った幅の色。映像の上でも読める明るさにする。 */
const LINE = '#ffffff';
const MARK = '#ffb02e';

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('seeked', done);
      resolve();
    };
    video.addEventListener('seeked', done);
    video.currentTime = time;
  });
}

/**
 * そのコマが本当に描かれるまで待つ。
 *
 * **seeked だけでは足りない。** 位置が変わっただけで、絵はまだ来ていないことがある。
 * そのまま canvas へ写すと、真っ黒な画像が残る。
 */
function painted(video: HTMLVideoElement): Promise<void> {
  // 端末によっては持っていない。型の上では必ずあることになっているので、実体で見る。
  const ask = (video as Partial<HTMLVideoElement>).requestVideoFrameCallback;

  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    if (typeof ask === 'function') ask.call(video, done);
    requestAnimationFrame(done);
    // **必ず起きる保証が無い。** 画面に出ていない動画では、
    // 次のコマが来たという知らせが来ないことがある。待ち続けないよう、時間で打ち切る。
    setTimeout(done, 150);
  });
}

/** 黒地に白抜きの札。映像の上に文字を置くと、地の色に負けて読めない。 */
function pill(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  unit: number,
  color = MARK,
): void {
  const size = unit * 3.4;
  ctx.save();
  ctx.font = `700 ${size}px system-ui, -apple-system, "Hiragino Kaku Gothic ProN", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const w = ctx.measureText(text).width + size;
  const h = size * 1.8;
  // 札がはみ出すと、数字が切れて読めなくなる。必ず絵の中に収める。
  const x = Math.min(Math.max(cx - w / 2, unit), Math.max(ctx.canvas.width - w - unit, unit));
  const y = Math.min(Math.max(cy - h / 2, unit), Math.max(ctx.canvas.height - h - unit, unit));

  ctx.fillStyle = 'rgba(0,0,0,0.78)';
  const round = (ctx as { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void })
    .roundRect;
  if (typeof round === 'function') {
    ctx.beginPath();
    round.call(ctx, x, y, w, h, h / 2);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, w, h);
  }

  ctx.fillStyle = color;
  ctx.fillText(text, x + w / 2, y + h / 2);
  ctx.restore();
}

/**
 * 測ったところを、絵の上に引く。
 *
 * **数字だけ出しても、どこを測ったのかは伝わらない。**
 * 地面の線と、腰の真下の線と、その間の幅。この3本が揃って、
 * はじめて「接地位置◯%」が絵として読める。
 */
function drawGap(
  ctx: CanvasRenderingContext2D,
  { hipX, hipY, footX, groundY, ahead, unit }: {
    hipX: number;
    hipY: number;
    footX: number;
    groundY: number;
    ahead: number;
    unit: number;
  },
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const barY = Math.min(groundY + unit * 7, h - unit * 12);

  ctx.save();
  ctx.lineCap = 'round';

  const twice = (draw: () => void, thick: number, thin: number, paint: string) => {
    ctx.setLineDash([unit * 2.4, unit * 2]);
    ctx.lineWidth = thick;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    draw();
    ctx.lineWidth = thin;
    ctx.strokeStyle = paint;
    draw();
    ctx.setLineDash([]);
  };

  // 地面。足が着いている高さ。
  twice(
    () => {
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.lineTo(w, groundY);
      ctx.stroke();
    },
    unit * 1.7,
    unit * 0.75,
    'rgba(255,255,255,0.8)',
  );

  // 腰の真下。**腰から下だけ引く。** 画面の上まで伸ばすと、体を横切ってうるさい。
  twice(
    () => {
      ctx.beginPath();
      ctx.moveTo(hipX, hipY);
      ctx.lineTo(hipX, barY + unit * 2);
      ctx.stroke();
    },
    unit * 1.7,
    unit * 0.75,
    'rgba(255,255,255,0.8)',
  );

  // 幅そのもの。両端に爪を立てて、どこからどこまでかを見せる。
  const bar = () => {
    ctx.beginPath();
    ctx.moveTo(hipX, barY);
    ctx.lineTo(footX, barY);
    ctx.moveTo(hipX, barY - unit * 1.7);
    ctx.lineTo(hipX, barY + unit * 1.7);
    ctx.moveTo(footX, barY - unit * 1.7);
    ctx.lineTo(footX, barY + unit * 1.7);
    ctx.stroke();
  };
  ctx.lineWidth = unit * 2.6;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  bar();
  ctx.lineWidth = unit * 1.2;
  ctx.strokeStyle = MARK;
  bar();
  ctx.restore();

  const percent = Math.round(ahead * 100);
  pill(
    ctx,
    `${percent >= 0 ? '前へ' : '後ろへ'} ${Math.abs(percent)}%`,
    (hipX + footX) / 2,
    barY + unit * 6,
    unit,
  );
}

/** 数字を1つ。単位は小さく添える。 */
function Stat({ label, value, unit, note }: { label: string; value: string; unit?: string; note?: string }) {
  return (
    <div className="min-w-0 flex-1 border-t border-line pt-1.5">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-0.5 truncate text-[19px] font-bold leading-tight tabular-nums">
        {value}
        {unit && <span className="ml-1 text-[11px] font-medium text-muted">{unit}</span>}
      </p>
      {note && <p className="mt-0.5 text-[10px] leading-relaxed text-muted">{note}</p>}
    </div>
  );
}

/** 見せる1コマと、その時に測った接地。**どちら側の足で着いたかが要る。** */
interface Shot {
  frame: Frame;
  contact: Contact;
  /** 進む向き。+1 なら画面の右へ。「前」がどっちかは、これが無いと分からない。 */
  facing: 1 | -1;
}

export default function RunFormSheet({
  onSend,
  onClose,
}: {
  /** 測った数字をコーチへ渡す。 */
  onSend: (text: string) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<GaitReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [shot, setShot] = useState<Shot | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<string | null>(null);

  // 読み込んだ動画の後片付け。**忘れると端末の中に残り続ける。**
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  /**
   * 測った瞬間を1枚の絵にする。
   *
   * **結果が画面に出てから呼ぶ。** canvas は結果が出て初めて描かれるので、
   * 測り終わった直後に触ると、まだ存在しない（参照が null のまま黒い箱が残る）。
   */
  const drawShot = useCallback(async ({ frame, contact, facing }: Shot) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!video || !canvas || !ctx) return;

    await seekTo(video, frame.t);
    await painted(video);

    canvas.width = SHOT_W;
    canvas.height = SHOT_H;

    // 体のまわりだけを切り出して、大きく出す。切れなければ、全部出す。
    const box = bodyBox(frame.points, SHOT_W / SHOT_H) ?? { x: 0, y: 0, w: 1, h: 1 };
    ctx.drawImage(
      video,
      box.x * video.videoWidth,
      box.y * video.videoHeight,
      box.w * video.videoWidth,
      box.h * video.videoHeight,
      0,
      0,
      SHOT_W,
      SHOT_H,
    );

    // 背景を少し落とす。**明るい路面の上では、白い線がそのままだと消える。**
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, 0, SHOT_W, SHOT_H);

    const points = inBox(frame.points, box);
    const unit = SHOT_W / 130;
    drawSkeleton(ctx, points, {
      width: unit,
      color: LINE,
      highlight: { bones: LEG_BONES[contact.side], color: MARK },
    });

    // 測ったのは、着いた足と、その側の腰。**平均を出した時と同じ側で描く。**
    const hip = points[contact.side === 'left' ? LM.leftHip : LM.rightHip];
    const ankle = points[contact.side === 'left' ? LM.leftAnkle : LM.rightAnkle];
    const toe = points[contact.side === 'left' ? LM.leftToe : LM.rightToe];
    if (hip && ankle) {
      drawGap(ctx, {
        hipX: hip.x * SHOT_W,
        hipY: hip.y * SHOT_H,
        footX: ankle.x * SHOT_W,
        groundY: Math.max(ankle.y, toe?.y ?? ankle.y) * SHOT_H,
        ahead: contact.ahead,
        unit,
      });
    }

    // **「前」がどっちかを書く。** 進む向きが分からないと、前後の話が読めない。
    pill(ctx, facing === 1 ? '進む向き →' : '← 進む向き', unit * 13, unit * 4, unit, LINE);
  }, []);

  // canvas は結果が出てから描かれる。そのあとで描き込む。
  useEffect(() => {
    if (shot) void drawShot(shot);
  }, [shot, drawShot]);

  const read = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    setReport(null);
    setShot(null);
    setSent(false);
    setProgress(0);

    try {
      const landmarker = await loadPoseForFrames();

      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(file);
      urlRef.current = url;

      const video = videoRef.current;
      if (!video) return;
      video.src = url;
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('動画を開けませんでした'));
      });

      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error('動画の長さが読めませんでした');
      }

      // 長く撮られていたら、真ん中を使う。撮り始めと撮り終わりは、たいてい走っていない。
      const span = Math.min(CLIP_SECONDS, duration);
      const from = Math.max(0, (duration - span) / 2);
      const count = Math.max(8, Math.min(MAX_FRAMES, Math.round(span * SAMPLE_FPS)));

      const frames: Frame[] = [];
      for (let i = 0; i < count; i += 1) {
        const t = from + (span * i) / (count - 1);
        await seekTo(video, t);
        const found = landmarker.detect(video);
        const points = found.landmarks?.[0];
        if (points) frames.push({ t, points });
        setProgress(Math.round(((i + 1) / count) * 100));
      }

      const result = analyzeGait(frames);
      setReport(result);

      if (result.measured && result.contacts.length > 0 && result.ahead !== undefined) {
        /**
         * **平均にいちばん近いコマを見せる。**
         * いちばん極端なコマを見せると、絵の上の数字と下に並べた平均が食い違って、
         * どちらを信じればいいのか分からなくなる。
         */
        const mean = result.ahead;
        const best = result.contacts.reduce((a, b) =>
          Math.abs(a.ahead - mean) <= Math.abs(b.ahead - mean) ? a : b,
        );
        setShot({ frame: frames[best.index], contact: best, facing: result.facing });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '動画を読めませんでした');
    } finally {
      setBusy(false);
    }
  }, []);

  const percent = (value: number | undefined) =>
    value === undefined ? '—' : `${Math.round(value * 100)}`;

  return (
    <Sheet label="走りを見てもらう" title="走りを見てもらう" onClose={onClose}>
      <p className="text-[13px] leading-relaxed text-muted">
        走っているところを<strong className="font-semibold text-fg">横から数秒</strong>撮って、
        その動画を選んでください。1コマずつ見て、接地の位置やピッチを数字にします。
        <strong className="font-semibold text-fg">動画はこの端末から出ません。</strong>
      </p>

      <ul className="mt-3 space-y-1 rounded-[14px] bg-sunken px-3.5 py-3 text-[11px] leading-relaxed text-muted">
        <li>・進む向きに対して、<strong className="font-semibold text-fg">真横</strong>から撮る</li>
        <li>・頭から足まで、全身が入るように</li>
        <li>・5〜10秒でじゅうぶんです</li>
      </ul>

      <input
        ref={pickRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void read(file);
        }}
      />

      <button
        type="button"
        disabled={busy}
        onClick={() => pickRef.current?.click()}
        className="mt-4 w-full rounded-full bg-accent py-3 text-[15px] font-bold text-[var(--accent-fg)] disabled:opacity-50"
      >
        {busy ? `読んでいます… ${progress}%` : '動画を選ぶ'}
      </button>

      {/*
        読み取りに使うだけ。画面には出さないが、**display:none にはしない。**
        描画を止められると、コマを canvas へ写した時に真っ黒になる。
      */}
      <video
        ref={videoRef}
        playsInline
        muted
        preload="auto"
        aria-hidden
        className="pointer-events-none absolute h-px w-px opacity-0"
      />

      {error && (
        <p className="mt-3 rounded-[12px] bg-warn-soft px-3 py-2 text-[12px] leading-relaxed text-warn">
          {error}
        </p>
      )}

      {report && !report.measured && (
        <p className="mt-4 rounded-[12px] bg-warn-soft px-3.5 py-3 text-[13px] leading-relaxed text-warn">
          {report.note}
        </p>
      )}

      {report?.measured && (
        <div className="mt-5">
          <canvas
            ref={canvasRef}
            className="block w-full rounded-[16px] bg-black"
            aria-label="測った瞬間の姿勢"
            role="img"
          />

          {/* **絵の読み方を書く。** 色が何を指しているか分からないと、線はただの落書き。 */}
          <dl className="mt-2 space-y-1 text-[11px] leading-relaxed text-muted">
            <div className="flex gap-2">
              <dt className="shrink-0 font-semibold" style={{ color: MARK }}>
                オレンジの脚
              </dt>
              <dd className="min-w-0">この瞬間に着いている足。横の幅が、腰の真下からのずれ。</dd>
            </div>
            <div className="flex gap-2">
              <dt className="shrink-0 font-semibold text-fg">白い点線</dt>
              <dd className="min-w-0">縦は腰の真下、横は足が着いている高さ。</dd>
            </div>
          </dl>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            測った{report.contacts.length}回のうち、平均にいちばん近い1回です。
            絵の中の数字は<strong className="font-semibold text-fg">この瞬間の値</strong>、
            下の「接地位置」は{report.contacts.length}回の平均です。
          </p>

          <div className="mt-4 flex gap-3">
            <Stat label="ピッチ" value={report.cadence ? `${report.cadence}` : '—'} unit="spm" />
            <Stat
              label="接地位置"
              value={percent(report.ahead)}
              unit="%"
              note="腰の真下から前へ。脚の長さに対する比"
            />
          </div>
          <div className="mt-3 flex gap-3">
            <Stat
              label="接地時の膝"
              value={report.knee ? `${Math.round(report.knee)}` : '—'}
              unit="°"
              note="180°が伸びきり"
            />
            <Stat
              label="体幹の前傾"
              value={report.lean !== undefined ? `${Math.round(report.lean)}` : '—'}
              unit="°"
              note="正が進行方向へ"
            />
          </div>
          <div className="mt-3 flex gap-3">
            <Stat label="上下動" value={percent(report.bounce)} unit="%" note="脚の長さに対する比" />
            <Stat label="測った接地" value={`${report.contacts.length}`} unit="回" />
          </div>

          {/*
            **数字だけ出して終わりにしない。** 良し悪しは速度と体の作りで変わるので、
            ここでは言えない。言葉にするのはコーチの仕事。
          */}
          <button
            type="button"
            disabled={sent}
            onClick={() => {
              onSend(describeGait(report));
              setSent(true);
              onClose();
            }}
            className="mt-5 w-full rounded-full bg-accent py-3 text-[15px] font-bold text-[var(--accent-fg)] disabled:opacity-50"
          >
            この数字をコーチに見てもらう
          </button>

          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            数字の良し悪しは、走る速度と体の作りで変わります。
            <strong className="font-semibold text-fg">同じ撮り方で何度か測って、自分の中での変化を見てください。</strong>
            真横から撮れていないと、角度そのものがずれます。
          </p>
        </div>
      )}
    </Sheet>
  );
}
