'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EXERCISES, type Evaluation, type ExerciseSpec } from '@/lib/exercise';
import { drawSkeleton, loadPose } from '@/lib/pose';
import { FIGURE_VIEWBOX, figureArt } from './FigureArt';
import Sheet from './Sheet';

/**
 * その場で見てもらう画面。
 *
 * カメラの映像から姿勢を取り、種目ごとの形になっているかを、その場で返す。
 *
 * **映像はこの端末から出ない。** 判定は全部ここで終わる。
 * 体が映っている動画をサーバーへ送る作りにはしていない。
 *
 * 作りの方針:
 *  - **言うのは一度に1つ。** 3つ同時に直せる人はいない
 *  - 直すところが無い時は、黙らずに「その形です」と言う。
 *    無言だと、映っていないのか合っているのかが分からない
 *  - 声かけは少し置いてから変える。1フレームごとに文字が入れ替わると読めない
 */

/** 声かけを変える間隔。これより速く入れ替えると、読む前に消える。 */
const CUE_HOLD_MS = 1200;

/** 回数を数える時の、戻りの判定。往復しないと1回にしない。 */
const REP_GAP_MS = 400;

function Ready({ exercise, onStart }: { exercise: ExerciseSpec; onStart: () => void }) {
  const art = figureArt(exercise.id);

  return (
    <div>
      <p className="text-[13px] leading-relaxed text-muted">{exercise.setup}</p>

      {art && (
        <div className="mt-3 overflow-hidden rounded-[14px] bg-sunken px-3 py-2">
          <svg
            viewBox={FIGURE_VIEWBOX}
            className="mx-auto block h-auto w-full max-w-[260px] text-fg"
            role="img"
            aria-label={`${exercise.name}の図`}
          >
            {art}
          </svg>
        </div>
      )}

      <button
        type="button"
        onClick={onStart}
        className="mt-4 w-full rounded-full bg-accent py-3 text-[15px] font-bold text-[var(--accent-fg)]"
      >
        カメラを始める
      </button>

      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        映像はこの端末の中だけで見ます。どこにも送りません。
      </p>
    </div>
  );
}

export default function FormCoachSheet({ onClose }: { onClose: () => void }) {
  const [exercise, setExercise] = useState<ExerciseSpec | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cue, setCue] = useState('体がうつるように構えてください');
  const [fix, setFix] = useState(false);
  const [score, setScore] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);

  // 描画の中で読む値。state にすると毎フレーム描き直しになる。
  const cueRef = useRef({ text: '', at: 0 });
  const holdRef = useRef({ since: 0, total: 0, was: false, changed: 0 });

  const stop = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setRunning(false);
  }, []);

  // 画面を閉じた時にカメラが残らないようにする。**ここを忘れるとランプが点いたままになる。**
  useEffect(() => stop, [stop]);

  const start = useCallback(
    async (spec: ExerciseSpec) => {
      setError(null);
      try {
        const landmarker = await loadPose();
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 960 } },
          audio: false,
        });
        streamRef.current = stream;

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setRunning(true);

        holdRef.current = { since: 0, total: 0, was: false, changed: 0 };
        setScore(0);

        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d') ?? null;

        const tick = () => {
          frameRef.current = requestAnimationFrame(tick);
          if (!video.videoWidth || !canvas || !ctx) return;

          if (canvas.width !== video.videoWidth) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }

          const now = performance.now();
          const result = landmarker.detectForVideo(video, now);
          const points = result.landmarks?.[0];

          ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (!points) return;

          // 骨格。**細い線1本では、実際の映像の上では読めない。**
          // 暗い縁取りの上に明るい線を重ねて、どんな背景でも形が立つようにする。
          drawSkeleton(ctx, points, { width: Math.max(2.5, canvas.width / 200) });

          const judged: Evaluation = spec.evaluate(points);

          // 声かけは少し置いてから変える。毎フレーム入れ替わると読めない。
          if (judged.cue !== cueRef.current.text && now - cueRef.current.at > CUE_HOLD_MS) {
            cueRef.current = { text: judged.cue, at: now };
            setCue(judged.cue);
            setFix(judged.fix);
          }

          const hold = holdRef.current;
          if (spec.count === 'hold') {
            if (judged.holding) {
              if (!hold.was) hold.since = now;
              hold.was = true;
              setScore(Math.floor((hold.total + (now - hold.since)) / 1000));
            } else {
              if (hold.was) hold.total += now - hold.since;
              hold.was = false;
            }
          } else if (judged.holding !== hold.was && now - hold.changed > REP_GAP_MS) {
            // 下ろして上げて、はじめて1回。上がりっぱなしでは数えない。
            if (judged.holding) hold.total += 1;
            hold.was = judged.holding;
            hold.changed = now;
            setScore(hold.total);
          }
        };

        tick();
      } catch (e) {
        const message = e instanceof Error ? e.message : '';
        setError(
          /permission|denied|NotAllowed/i.test(message)
            ? 'カメラを使う許可が要ります。ブラウザの設定から許可してください。'
            : 'カメラを始められませんでした。ほかのアプリがカメラを使っていないか確かめてください。',
        );
        stop();
      }
    },
    [stop],
  );

  return (
    <Sheet
      label="フォームを見てもらう"
      title={exercise ? exercise.name : '動きを見てもらう'}
      onClose={() => {
        stop();
        onClose();
      }}
      onBack={exercise ? () => { stop(); setExercise(null); } : undefined}
      backLabel={exercise ? '種目' : undefined}
    >
      {!exercise && (
        <div>
          <p className="text-[13px] leading-relaxed text-muted">
            カメラに映すと、その場で形を見ます。
            <strong className="font-semibold text-fg">映像はこの端末から出ません。</strong>
          </p>
          <ul className="mt-3 space-y-2">
            {EXERCISES.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setExercise(item)}
                  className="flex w-full items-center gap-3 rounded-[14px] border border-line bg-bg px-3.5 py-3 text-left active:opacity-70"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold">{item.name}</span>
                    <span className="block text-[11px] text-muted">
                      {item.view === 'side' ? '横から撮ります' : '正面から撮ります'} ／
                      {item.count === 'hold' ? '時間で数えます' : '回数で数えます'}
                    </span>
                  </span>
                  <span className="shrink-0 text-[13px] text-muted">›</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {exercise && !running && (
        <>
          <Ready exercise={exercise} onStart={() => void start(exercise)} />
          {error && (
            <p className="mt-3 rounded-[12px] bg-warn-soft px-3 py-2 text-[12px] leading-relaxed text-warn">
              {error}
            </p>
          )}
        </>
      )}

      <div className={running ? 'block' : 'hidden'}>
        <div className="relative overflow-hidden rounded-[16px] bg-black">
          <video ref={videoRef} playsInline muted className="block h-auto w-full" />
          <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        </div>

        {/* 言うのは一度に1つ。 */}
        <p
          className={`mt-3 rounded-[14px] px-3.5 py-3 text-[15px] font-semibold leading-relaxed ${
            fix ? 'bg-warn-soft text-warn' : 'bg-accent-soft text-accent'
          }`}
        >
          {cue}
        </p>

        <div className="mt-3 flex items-center gap-3">
          <p className="min-w-0 flex-1 text-[13px] text-muted">
            {exercise?.count === 'hold' ? '保てている時間' : '数えた回数'}
            <strong className="ml-2 text-[20px] font-bold tabular-nums text-fg">
              {score}
              <span className="ml-0.5 text-[12px] font-medium text-muted">
                {exercise?.count === 'hold' ? '秒' : '回'}
              </span>
            </strong>
          </p>
          <button
            type="button"
            onClick={stop}
            className="shrink-0 rounded-full border border-line px-4 py-2 text-[13px] font-semibold"
          >
            やめる
          </button>
        </div>
      </div>
    </Sheet>
  );
}
