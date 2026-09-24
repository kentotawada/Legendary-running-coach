'use client';

import Sheet from './Sheet';
import { STRAVA_SETTINGS_URL } from '@/lib/strava';

interface Props {
  /** つないだのに練習が1件も見つからなかった直後か。 */
  empty?: boolean;
  onClose: () => void;
}

interface Step {
  title: string;
  detail?: string;
  /** 画面の表示が英語の場合の呼び名。版によって日本語訳が変わるため。 */
  english?: string;
}

/**
 * Garmin の時計をつなぐ手順。
 *
 * Garmin は公式の窓口を個人開発者に開いていないので、Strava を経由します。
 * ここでつまずく人がいちばん多いので、**一度だけ**という事実と、
 * 各画面の表示名（日本語と英語の両方）を先に出します。
 */
const STEPS: Step[] = [
  {
    title: 'Strava アプリを開く',
    detail: '入れていなければ、先にインストールしてアカウントを作ってください（無料で使えます）',
  },
  {
    title: '右下の「あなた」→ 右上の歯車（設定）',
    english: 'You → 設定アイコン',
  },
  {
    title: '「アプリ、サービス、デバイスをリンク」を開く',
    detail: '表示はアプリの版で少し変わります。似た名前の項目を探してください',
    english: 'Connect an App or Device',
  },
  {
    title: '一覧から Garmin を選んで「接続」',
    english: 'Garmin → Connect Garmin',
  },
  {
    title: 'Garmin Connect のメールアドレスとパスワードでログイン',
    detail: '時計を買った時に作ったアカウントです',
  },
  {
    title: '求められた権限を「許可」する',
    detail: 'ここまでで設定は終わりです',
  },
];

export default function StravaGuide({ empty = false, onClose }: Props) {
  return (
    <Sheet label="Garminとつなぐ手順" title="Garmin の時計とつなぐ" onClose={onClose}>
      {empty && (
        <div className="mb-3 rounded-[var(--radius)] border border-[color:var(--accent)] bg-accent-soft px-4 py-3 text-[13px] leading-relaxed text-accent">
          Strava に練習が1件も見つかりませんでした。
          <strong className="font-semibold">Garmin と Strava のリンクが、まだかもしれません。</strong>
        </div>
      )}

      <p className="text-[13px] leading-relaxed text-muted">
        Garmin は外部の開発者に直接の窓口を開いていないため、Strava を間に挟みます。
        <strong className="font-semibold text-fg">設定は一度だけ。</strong>
        あとは走るたびに、時計 → Garmin Connect → Strava → このアプリ、と自動で流れます。
      </p>

      <ol className="mt-4 space-y-3">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[12px] font-bold text-[var(--accent-fg)]">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium leading-relaxed">{step.title}</span>
              {step.english && (
                <span className="mt-0.5 block text-[12px] text-muted">英語表示: {step.english}</span>
              )}
              {step.detail && (
                <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{step.detail}</span>
              )}
            </span>
          </li>
        ))}
      </ol>

      <a
        href={STRAVA_SETTINGS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 block rounded-full bg-accent px-4 py-3 text-center text-[14px] font-semibold text-[var(--accent-fg)]"
      >
        Strava の設定を開く
      </a>

      <div className="mt-5 rounded-[14px] bg-sunken px-3.5 py-3">
        <p className="text-[13px] font-semibold">このあと、どうなるか</p>
        <ul className="mt-1.5 space-y-1 text-[12px] leading-relaxed text-muted">
          <li>・走り終えて時計が Garmin Connect に同期されると、数分で Strava に届きます</li>
          <li>・このアプリは、開いた時に Strava から自動で取り込みます</li>
          <li>
            ・<strong className="font-semibold text-fg">連携より前の活動は、Garmin からは遡りません。</strong>
            ただし Strava にすでにある分は、こちらが90日前まで取り込みます
          </li>
        </ul>
      </div>

      <div className="mt-3 rounded-[14px] bg-sunken px-3.5 py-3">
        <p className="text-[13px] font-semibold">入ってこない時に見るところ</p>
        <ul className="mt-1.5 space-y-1 text-[12px] leading-relaxed text-muted">
          <li>・時計と Garmin Connect アプリの同期ができているか（Bluetooth）</li>
          <li>・Garmin Connect 側でも連携が有効か（設定 → 接続済みのアプリ）</li>
          <li>・一度リンクを解除して、つなぎ直すと直ることが多いです</li>
          <li>・それでも駄目なら、これまでどおりスクリーンショットを送ってください。同じように読み取ります</li>
        </ul>
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-muted">
        Garmin 以外（Apple Watch・COROS・Suunto・Polar・Nike Run Club など）も、
        Strava につながっていれば同じように取り込めます。
      </p>
    </Sheet>
  );
}
