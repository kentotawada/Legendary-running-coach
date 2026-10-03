'use client';

import { useState } from 'react';
import { generateSecret, generateVapidKeys } from '@/lib/keygen';

/**
 * 通知の鍵を、この端末の中だけで作る画面。
 *
 * **これまでの手順は、パソコンが要るものだった。**
 * `npx web-push generate-vapid-keys` はターミナルが無ければ打てない。
 * スマホしか持っていない人は、そこで止まる。
 *
 * ここで作った鍵は、**この端末から1歩も出ない。**
 * サーバーにも送らないし、こちらにも届かない。
 * 画面に出た文字を、本人が Vercel に貼る。それだけ。
 */

interface Row {
  name: string;
  value: string;
  note: string;
  secret: boolean;
}

export default function KeySetup() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 秘密の値を伏せておく。**人前で開く可能性がある。** */
  const [revealed, setRevealed] = useState(false);

  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      const keys = await generateVapidKeys(window.crypto.subtle);
      setRows([
        {
          /*
            **NEXT_PUBLIC_ を付けない。**

            ブラウザはこの鍵を、ビルド時の埋め込みではなく
            /api/push/key から実行時に取りに行っている（push-client.ts）。
            だから公開用の接頭辞は要らない。

            付けると Vercel が「ブラウザに露出する値です」と警告を出すうえ、
            NEXT_PUBLIC_ はビルド時に焼き込まれるので、
            値を変えるたびに再ビルドが要るようになる。何も得がない。
          */
          name: 'VAPID_PUBLIC_KEY',
          value: keys.publicKey,
          note: 'ブラウザに渡す公開鍵。人に見られても困りません',
          secret: false,
        },
        {
          name: 'VAPID_PRIVATE_KEY',
          value: keys.privateKey,
          note: 'サーバーだけが持つ秘密鍵。絶対に人に見せないでください',
          secret: true,
        },
        {
          name: 'CRON_SECRET',
          value: generateSecret(window.crypto),
          note: '通知の送信口を守る合言葉。これも秘密です',
          secret: true,
        },
      ]);
      setRevealed(false);
    } catch (e) {
      setError(
        e instanceof Error
          ? `鍵を作れませんでした: ${e.message}`
          : '鍵を作れませんでした。別のブラウザで開いてみてください。',
      );
    } finally {
      setBusy(false);
    }
  };

  const copy = async (row: Row) => {
    try {
      await navigator.clipboard.writeText(row.value);
      setCopied(row.name);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setError('コピーできませんでした。長押しして選択してください。');
    }
  };

  return (
    <main className="mx-auto max-w-[680px] px-4 py-8">
      <h1 className="t-title font-bold">通知の鍵を作る</h1>
      <p className="mt-2 t-note leading-relaxed text-muted">
        押すと、この端末の中だけで鍵を作ります。
        <strong className="font-semibold text-fg">
          作った鍵は、どこにも送信されません。
        </strong>
        サーバーにも残りません。出てきた文字を Vercel に貼ってください。
      </p>

      <button
        type="button"
        onClick={() => void make()}
        disabled={busy}
        className="mt-5 w-full rounded-full bg-accent py-3.5 t-body font-bold text-[var(--accent-fg)] active:scale-[0.99] disabled:opacity-40"
      >
        {busy ? '作っています…' : rows ? 'もう一度作り直す' : '鍵を作る'}
      </button>

      {error && (
        <p className="mt-4 rounded-[12px] bg-warn-soft px-3.5 py-2.5 t-note leading-relaxed text-warn">
          {error}
        </p>
      )}

      {rows && (
        <>
          {/*
            **一度配ってからは、作り直してはいけない。**
            鍵を変えると、すでに通知を登録した人の宛先が全部無効になる。
            本人には「通知が来なくなった」としか見えず、原因に辿り着けない。
          */}
          <p className="mt-5 rounded-[12px] bg-warn-soft px-3.5 py-2.5 t-note leading-relaxed text-warn">
            <strong className="font-bold">作り直すのは、人に配る前だけ。</strong>
            通知を登録した人がいる状態で鍵を変えると、
            その人たちに通知が届かなくなります（画面には何も出ません）。
          </p>

          <div className="mt-4 flex items-center justify-between">
            <p className="t-note font-bold">Vercel に貼る3つ</p>
            <button
              type="button"
              onClick={() => setRevealed((value) => !value)}
              className="rounded-full bg-sunken px-3 py-1.5 t-note font-semibold"
            >
              {revealed ? '秘密の値を隠す' : '秘密の値を表示'}
            </button>
          </div>

          <ul className="mt-2 space-y-3">
            {rows.map((row) => (
              <li key={row.name} className="rounded-[14px] bg-sunken px-3.5 py-3">
                <p className="t-note font-bold tabular-nums">{row.name}</p>
                <p className="mt-0.5 t-note leading-relaxed text-muted">{row.note}</p>
                <p className="mt-2 break-all rounded-[10px] bg-bg px-3 py-2 font-mono t-note leading-relaxed">
                  {row.secret && !revealed ? '•'.repeat(32) : row.value}
                </p>
                <button
                  type="button"
                  onClick={() => void copy(row)}
                  className="mt-2 rounded-full bg-bg px-3.5 py-2 t-note font-semibold active:scale-[0.98]"
                >
                  {copied === row.name ? 'コピーしました' : 'コピー'}
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-6 rounded-[14px] bg-sunken px-3.5 py-3">
            <p className="t-note font-bold">このあと（スマホのブラウザで）</p>
            <ol className="mt-2 space-y-1.5 t-note leading-relaxed text-muted">
              <li>1. vercel.com を開いて、このプロジェクトを選ぶ</li>
              <li>2. Settings → Environment Variables</li>
              <li>
                3. 上の3つを、名前と値をそのまま貼って追加する（Production を選ぶ）
              </li>
              <li>
                4. ついでに <code className="font-mono">VAPID_SUBJECT</code> も足す。値は{' '}
                <code className="font-mono">mailto:自分のメールアドレス</code>
              </li>
              <li>5. Deployments → 最新の「…」→ Redeploy</li>
              <li>
                6. <code className="font-mono">/api/health</code> を開いて、
                「通知」が <code className="font-mono">ready: true</code> になっていれば完了
              </li>
            </ol>
            <p className="mt-2 t-note leading-relaxed text-muted">
              <strong className="font-semibold text-fg">貼り終わったら、この画面は閉じてください。</strong>
              値はどこにも保存していないので、閉じれば消えます。
            </p>
          </div>
        </>
      )}
    </main>
  );
}
