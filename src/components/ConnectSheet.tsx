'use client';

import { useEffect, useState } from 'react';
import type { StravaConnection } from '@/lib/types';
import {
  CONNECT_SOURCES,
  FORMAT_ORDER,
  GARMIN_EXPORT_STEPS,
  GARMIN_URL,
  findSource,
  needsSetup,
  type ConnectSource,
  type SourceId,
} from '@/lib/connections';
import { STRAVA_URL } from '@/lib/strava';
import Sheet from './Sheet';

interface Props {
  connection?: StravaConnection;
  /** このアプリで自動連携が使える設定になっているか。 */
  available: boolean;
  /** 書き出したファイルから取り込む。 */
  onImportFiles?: (files: File[]) => void;
  /** つないだのに練習が1件も見つからなかった直後か。 */
  empty?: boolean;
  syncing?: boolean;
  syncMessage?: string | null;
  onSync?: () => void;
  onDisconnect?: () => void;
  onClose: () => void;
  /** カルテから開かれた時だけ渡す。閉じたらカルテへ戻す。 */
  onBack?: () => void;
}

/** 選んだ道具は端末に覚えておく。毎回選び直させない。 */
const PICK_KEY = 'coach.connect.source';

function loadPick(): SourceId | null {
  try {
    const value = localStorage.getItem(PICK_KEY);
    return value && findSource(value) ? (value as SourceId) : null;
  } catch {
    return null;
  }
}

function savePick(id: SourceId) {
  try {
    localStorage.setItem(PICK_KEY, id);
  } catch {
    // 使えない環境（プライベートブラウズ等）でも、選ぶこと自体は動かす。
  }
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-[var(--radius)] border border-line px-4 py-3.5">{children}</div>;
}

/**
 * 書き出したファイルから取り込む口。
 *
 * **ここだけは、誰の許可も要りません。** 外部サービスの窓口は相手の都合で有料になったり
 * 閉じたりしますが、自分の記録を書き出す権利は取り上げられない。
 * 過去の練習をまとめて入れる時にも、ここが一番早い。
 */
function FileImport({
  onImportFiles,
  onPick,
  busy,
  message,
}: {
  onImportFiles?: (files: File[]) => void;
  onPick: () => void;
  busy: boolean;
  /** 取り込みの結果。押した場所のすぐ下に出す。 */
  message?: string | null;
}) {
  if (!onImportFiles) return null;

  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="text-[13px] font-semibold">ファイルから取り込む</p>
      <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
        連携を使わずに入れる道です。<strong className="font-semibold text-fg">過去の練習をまとめて</strong>
        入れる時にも使えます。Garmin Connect などから書き出したファイル（
        <strong className="font-semibold text-fg">FIT</strong>・TCX・GPX）を選んでください。
        <strong className="font-semibold text-fg">zip のままでも開けます。</strong>
        入力欄の「＋」からも同じことができます。
      </p>

      {/*
        書き出しは Garmin Connect のブラウザ版にしかない。
        **スマホのアプリにはこの機能が無い**（「⋮」は編集・削除だけ、「共有」はリンク）。
        探させると必ず迷うので、入口と手順をここに置く。
      */}
      <div className="mt-2.5 rounded-[14px] bg-sunken px-3.5 py-3">
        <p className="text-[12px] font-semibold">Garmin の記録を書き出す</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
          <strong className="font-semibold text-fg">スマホの Garmin Connect アプリでは書き出せません。</strong>
          ブラウザ版から取り出します。
        </p>
        <ol className="mt-2 space-y-1.5">
          {GARMIN_EXPORT_STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-2">
              <span className="mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-[var(--accent-fg)]">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-medium leading-relaxed">{step.title}</span>
                {step.english && (
                  <span className="mt-0.5 block text-[10px] text-muted">英語表示: {step.english}</span>
                )}
                {step.detail && (
                  <span className="mt-0.5 block text-[10px] leading-relaxed text-muted">{step.detail}</span>
                )}
              </span>
            </li>
          ))}
        </ol>
        <a
          href={GARMIN_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2.5 inline-block rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-[var(--accent-fg)]"
        >
          Garmin Connect を開く
        </a>
        <p className="mt-1.5 text-[10px] leading-relaxed text-muted">
          ログインを求められたら、一度入れば次から続きます。
          Safari の共有 →「ホーム画面に追加」で、アイコンから直接開けるようになります。
        </p>
      </div>

      <label
        className={`mt-2.5 inline-block cursor-pointer rounded-full border border-[color:var(--accent)] px-4 py-2 text-[13px] font-semibold text-accent ${
          busy ? 'opacity-40' : ''
        }`}
      >
        {busy ? '取り込み中…' : 'ファイルを選ぶ'}
        {/*
          accept は付けない。
          iOS の「ファイル」は拡張子から種類を引けないと、**選べない状態（灰色）にしてしまう。**
          .tcx も .fit も、その種類に登録が無い。絞り込みのために選べなくするのは本末転倒なので、
          何でも選べるようにして、読めなかった時に理由を言う側で受け止める。
        */}
        <input
          type="file"
          multiple
          disabled={busy}
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            // 同じファイルをもう一度選べるように、値を戻しておく。
            event.target.value = '';
            if (files.length === 0) return;
            onPick();
            onImportFiles(files);
          }}
        />
      </label>

      {/*
        押したのに何も言われない、がいちばん不安になる。
        結果は、押したボタンのすぐ下に出す。
      */}
      {message && <p className="mt-2 text-[13px] leading-relaxed text-accent">{message}</p>}

      <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
        <strong className="font-semibold text-fg">FIT なら、上下動・接地時間・左右バランス・パワーまで入ります。</strong>
        GPX / TCX には、そこまでは入っていません。同じ練習を二度入れても、重なりません。
      </p>
    </div>
  );
}

function StepList({ steps }: { steps: ConnectSource['steps'] }) {
  return (
    <ol className="mt-3 space-y-2.5">
      {steps.map((step, index) => (
        <li key={step.title} className="flex gap-2.5">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-[var(--accent-fg)]">
            {index + 1}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium leading-relaxed">{step.title}</span>
            {step.english && (
              <span className="mt-0.5 block text-[11px] text-muted">英語表示: {step.english}</span>
            )}
            {step.detail && (
              <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">{step.detail}</span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * 連携の画面。
 *
 * 全社ぶんの手順を並べると、自分に関係のある3行を探す作業から始まってしまいます。
 * そこで **使っている物をひとつ選んでもらい、その1本だけを出します。**
 * 届いた記録から出どころが分かっている道具は、手順ごと畳みます。済んだ作業を見せないためです。
 */
export default function ConnectSheet({
  connection,
  available,
  empty = false,
  syncing = false,
  syncMessage,
  onSync,
  onImportFiles,
  onDisconnect,
  onClose,
  onBack,
}: Props) {
  const [picked, setPicked] = useState<SourceId | null>(null);
  /** 取り込みの結果を、Strava の欄とファイルの欄のどちらに出すか。 */
  const [usedFile, setUsedFile] = useState(false);
  const connected = Boolean(connection);
  const detected = (connection?.sources ?? []) as SourceId[];

  // 端末に覚えた選択は、描かれた後でないと読めない。
  useEffect(() => {
    setPicked(loadPick());
  }, []);

  // 何も選んでいなくても、出どころが分かっているならそれを開いておく。
  const source = findSource(picked ?? detected[0]);
  const done = source ? !needsSetup(source, detected) : false;

  const choose = (id: SourceId) => {
    setPicked(id);
    savePick(id);
  };

  if (!available) {
    return (
      <Sheet
        label="ランニングアプリとの連携"
        title="連携する"
        onClose={onClose}
        onBack={onBack}
        backLabel={onBack ? 'カルテ' : undefined}
      >
        <p className="text-[13px] leading-relaxed text-muted">
          このアプリでは、いま自動連携を使える設定になっていません。
          記録は、これまでどおり<strong className="font-semibold text-fg">画面のスクリーンショット</strong>
          を送ってください。距離・ペース・心拍・ピッチまで読み取ります。
        </p>
        <FileImport
          onImportFiles={onImportFiles}
          onPick={() => setUsedFile(true)}
          busy={syncing}
          message={syncMessage}
        />
      </Sheet>
    );
  }

  return (
    <Sheet
      label="ランニングアプリとの連携"
      title="連携する"
      onClose={onClose}
      onBack={onBack}
      backLabel={onBack ? 'カルテ' : undefined}
    >
      {empty && (
        <div className="mb-3 rounded-[var(--radius)] border border-[color:var(--accent)] bg-accent-soft px-4 py-3 text-[13px] leading-relaxed text-accent">
          Strava に練習が1件も見つかりませんでした。
          <strong className="font-semibold">下の②が、まだ残っているかもしれません。</strong>
        </div>
      )}

      {/*
        すべて済んでいる人に、これからの手順を読ませない。
        「自分の設定は正しかった」を最初の一行で確定させる。
      */}
      {connected && done && source ? (
        <p className="rounded-[var(--radius)] border border-[color:var(--accent)] bg-accent-soft px-4 py-3 text-[13px] leading-relaxed text-accent">
          <strong className="font-bold">✓ 連携は完了しています。</strong>
          {source.route === 'direct'
            ? ' 走り終えた記録が、そのまま入ってきます。'
            : ` ${source.name}から、走り終えるたびに記録が届いています。`}
        </p>
      ) : (
        <p className="text-[13px] leading-relaxed text-muted">
          つないでおくと、<strong className="font-semibold text-fg">走り終えた時点で記録が入っています。</strong>
          スクリーンショットを送る必要がなくなります。
          <span className="mt-1 block">
            どの時計・アプリも、Strava を通って届きます。設定は最初の一度だけです。
          </span>
        </p>
      )}

      {/* ① こちら側。押せば終わる、いちばん確実な一手を先に置く。 */}
      <div className="mt-4">
        <p className="mb-1.5 text-[12px] font-bold text-muted">① このアプリと Strava</p>
        <Card>
          {connected ? (
            <>
              <p className="text-[14px] font-semibold text-accent">
                ✓ つながっています
                {connection?.athleteName && (
                  <span className="ml-1.5 text-[12px] font-normal text-muted">
                    {connection.athleteName}
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-[12px] text-muted">
                {connection?.lastSyncedAt
                  ? `最終取り込み ${new Date(connection.lastSyncedAt).toLocaleString('ja-JP', {
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`
                  : 'まだ取り込んでいません'}
                {connection?.imported ? ` / これまで${connection.imported}件` : ''}
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onSync}
                  disabled={syncing}
                  className="rounded-full bg-accent px-3.5 py-2 text-[13px] font-semibold text-[var(--accent-fg)] disabled:opacity-40"
                >
                  {syncing ? '取り込み中…' : '今すぐ取り込む'}
                </button>
                <button
                  type="button"
                  onClick={onDisconnect}
                  disabled={syncing}
                  className="text-[12px] text-muted underline underline-offset-4 disabled:opacity-40"
                >
                  連携を解除
                </button>
              </div>
              {!usedFile && syncMessage && (
                <p className="mt-1.5 text-[12px] text-accent">{syncMessage}</p>
              )}
            </>
          ) : (
            <>
              <p className="text-[13px] leading-relaxed text-muted">
                押すと Strava の許可画面が開きます。戻ってくれば、ここは終わりです（約20秒）。
              </p>
              <a
                href="/api/strava/connect"
                className="mt-2 inline-block rounded-full bg-accent px-5 py-2.5 text-[14px] font-semibold text-[var(--accent-fg)]"
              >
                Strava とつなぐ
              </a>
            </>
          )}
        </Card>
      </div>

      {/* ② 相手側。自分に関係のある1本だけを出すために、まず選んでもらう。 */}
      <div className="mt-4">
        <p className="mb-1.5 text-[12px] font-bold text-muted">② いつも使っている時計・アプリ</p>

        <div className="grid grid-cols-2 gap-2">
          {CONNECT_SOURCES.map((item) => {
            const active = source?.id === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => choose(item.id)}
                aria-pressed={active}
                className={[
                  'flex items-center gap-2 rounded-[14px] border px-3 py-2.5 text-left transition active:scale-[0.98]',
                  active ? 'border-[color:var(--accent)] bg-accent-soft' : 'border-line bg-bg',
                ].join(' ')}
              >
                <span aria-hidden="true" className="shrink-0 text-[17px]">
                  {item.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-[13px] font-semibold ${active ? 'text-accent' : ''}`}
                  >
                    {item.name}
                  </span>
                  {item.hint && (
                    <span className="block truncate text-[10px] leading-tight text-muted">
                      {item.hint}
                    </span>
                  )}
                </span>
                {detected.includes(item.id) && (
                  <span aria-label="記録が届いています" className="shrink-0 text-[12px] font-bold text-accent">
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {source && (
          <div className="mt-3">
            <Card>
              <div className="flex items-baseline gap-2">
                <p className="min-w-0 flex-1 text-[14px] font-bold">{source.name}</p>
                {done && <p className="shrink-0 text-[11px] font-semibold text-accent">もう届いています</p>}
              </div>

              {done && (
                <p className="mt-1.5 text-[13px] leading-relaxed text-accent">
                  {source.route === 'direct'
                    ? '✓ ①だけで終わりです。ほかに設定はありません。'
                    : `✓ ${source.name}から記録が届いています。設定は完了しています。`}
                </p>
              )}

              {/*
                **記録ファイルを先に出す。** いちばん情報が入る道なので、
                そこに辿り着けなかった人だけがスクリーンショットへ降りればいい。
              */}
              <div className="mt-3">
                <p className="text-[12px] font-bold">
                  記録ファイルで送る
                  <span className="ml-1.5 font-normal text-muted">いちばん詳しい</span>
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">{source.exportHint}</p>
                {source.canExport !== 'none' && (
                  <>
                    {source.exportFormats && (
                      <p className="mt-1 text-[11px] text-muted">
                        形式: <strong className="font-semibold text-fg">{source.exportFormats}</strong>
                      </p>
                    )}
                    <p className="mt-1 text-[11px] leading-relaxed text-muted">{FORMAT_ORDER}</p>
                  </>
                )}
              </div>

              {/* どこで詰まっても、ここへ降りれば必ず届く。 */}
              <div className="mt-3 border-t border-line pt-2.5">
                <p className="text-[12px] font-bold">
                  スクリーンショットで送る
                  <span className="ml-1.5 font-normal text-muted">どのアプリでも</span>
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  入力欄の「＋」→「練習データの画像を送る」。
                  距離・ペース・心拍・ピッチまで読み取ります。
                  {source.canExport === 'none' && (
                    <strong className="font-semibold text-fg">
                      {' '}
                      このアプリではこちらが確実です。
                    </strong>
                  )}
                </p>
              </div>

              {/* Strava 連携が使える環境でだけ出す。今は設定が無ければ出ない。 */}
              {available && source.route === 'link' && !done && (
                <details className="mt-3 border-t border-line pt-2.5">
                  <summary className="cursor-pointer text-[12px] font-bold">
                    Strava につないで、書き出しをやめる
                  </summary>
                  <StepList steps={source.steps} />
                  <a
                    href={STRAVA_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-block rounded-full border border-[color:var(--accent)] px-4 py-2 text-[13px] font-semibold text-accent"
                  >
                    Strava を開く
                  </a>
                  {source.caution && (
                    <p className="mt-3 rounded-[12px] bg-sunken px-3 py-2 text-[11px] leading-relaxed text-muted">
                      {source.caution}
                    </p>
                  )}
                </details>
              )}
            </Card>
          </div>
        )}
      </div>

      <FileImport
        onImportFiles={onImportFiles}
        onPick={() => setUsedFile(true)}
        busy={syncing}
        message={usedFile ? syncMessage : null}
      />

      {/*
        どの道でも詰まる人は必ずいる。逃げ道を最後に置いておく。
        「つながらなかったから使えない」で終わらせないため。
      */}
      <div className="mt-4 rounded-[14px] bg-sunken px-3.5 py-3">
        <p className="text-[12px] font-semibold">スクリーンショットで送る時のコツ</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          何枚も撮らなくて済む方法があります。Safari で開いた画面なら、
          スクリーンショットを撮った直後に左下の小さい画像を押し、上の
          <strong className="font-semibold text-fg">「フルページ」</strong>
          を選ぶと、<strong className="font-semibold text-fg">スクロールした先まで1枚（PDF）で保存できます。</strong>
          それをそのまま送れば、全部まとめて読み取ります。
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
          アプリの画面は「フルページ」にできないことがあります。その時は今までどおり
          何枚かに分けて送ってください。縦に長い画像も、読める大きさに切り分けて扱います。
        </p>
      </div>
    </Sheet>
  );
}
