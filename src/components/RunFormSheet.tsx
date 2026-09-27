'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LM } from '@/lib/exercise';
import { analyzeGait, describeGait, type Frame, type GaitReport } from '@/lib/gait';
import { BONES, loadPoseForFrames } from '@/lib/pose';
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
  const [keyFrame, setKeyFrame] = useState<Frame | null>(null);

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
   * いちばん体の真下で着いていたコマに、骨格を描いて見せる。
   *
   * **結果が画面に出てから呼ぶ。** canvas は結果が出て初めて描かれるので、
   * 測り終わった直後に触ると、まだ存在しない（参照が null のまま黒い箱が残る）。
   */
  const drawKeyFrame = useCallback(async (frame: Frame) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!video || !canvas || !ctx) return;

    await seekTo(video, frame.t);
    await painted(video);
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const points = frame.points;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = Math.max(2, canvas.width / 200);
    ctx.lineCap = 'round';
    for (const [from, to] of BONES) {
      const a = points[from];
      const b = points[to];
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
      ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
      ctx.stroke();
    }

    // 腰の真下を示す線。**足との距離が「接地位置」。**
    const hip = points[LM.leftHip];
    if (hip) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = Math.max(1, canvas.width / 400);
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(hip.x * canvas.width, 0);
      ctx.lineTo(hip.x * canvas.width, canvas.height);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, []);

  // canvas は結果が出てから描かれる。そのあとで描き込む。
  useEffect(() => {
    if (keyFrame) void drawKeyFrame(keyFrame);
  }, [keyFrame, drawKeyFrame]);

  const read = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      setReport(null);
      setKeyFrame(null);
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

        if (result.measured && result.contacts.length > 0) {
          // いちばん真下に近いところで着いたコマを見せる。描くのは画面に出てから。
          const best = result.contacts.reduce((a, b) => (Math.abs(a.ahead) <= Math.abs(b.ahead) ? a : b));
          setKeyFrame(frames[best.index]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : '動画を読めませんでした');
      } finally {
        setBusy(false);
      }
    },
    [drawKeyFrame],
  );

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
          <canvas ref={canvasRef} className="block w-full rounded-[16px] bg-black" />
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            いちばん体の真下で着いていた瞬間。縦の点線が腰の位置です。
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
