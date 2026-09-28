import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

/**
 * 欧文と数字の書体。
 *
 * **和文は端末のものに任せる。** 日本語のウェブフォントは数MBあり、
 * 毎日開くアプリで毎回読ませる重さではない。iPhone のヒラギノは、
 * わざわざ差し替える理由が無いほどよく出来ている。
 *
 * 一方で、このアプリは数字だらけ（1,666km・5:02/km・180spm）。
 * そこが端末の既定のままだと、**数字の並びが揃わず、素人の画面に見える。**
 * 欧文だけ差し替えて、和文はその後ろに続かせる。
 */
const latin = Inter({
  subsets: ['latin'],
  variable: '--font-latin',
  display: 'swap',
});
import { FONT_SIZE_BOOT_SCRIPT } from '@/lib/display';
import { Analytics } from '@vercel/analytics/next';
import ErrorReporter from '@/components/ErrorReporter';

export const metadata: Metadata = {
  title: 'RUNCOACH',
  description:
    '走るあなたに、専属のコーチを。練習の記録を見て、その日その日で言葉をかけます。痛みがある日は、絶対に走らせません。',
  manifest: '/manifest.webmanifest',
  // iOS はホーム画面の追加に PNG を求める。置けないと通知も使えない。
  icons: {
    icon: [
      { url: '/icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'RUNCOACH',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // ホーム画面から起動した時に、ノッチの下まで背景を敷く。
  viewportFit: 'cover',
  // 入力欄のダブルタップ拡大を防ぎつつ、ピンチズームは残す。
  maximumScale: 5,
  themeColor: [
    // **本文の背景と同じ値にする。** ずれていると、ホーム画面から開いた時に
    // ノッチの周りだけ色が違って見え、それだけで作りが粗く見える。
    { media: '(prefers-color-scheme: light)', color: '#fcfcfb' },
    { media: '(prefers-color-scheme: dark)', color: '#0f0f11' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={latin.variable}>
      <head>
        {/*
          文字サイズは描画の前に当てる。読み込んでから切り替えると、
          大きい設定にしている人の画面が毎回一瞬だけ小さく見えてしまう。
        */}
        <script dangerouslySetInnerHTML={{ __html: FONT_SIZE_BOOT_SCRIPT }} />
      </head>
      <body className="antialiased">
        {children}
        {/*
          どこから来て、どの端末で見ているか。Cookie を使わず、個人を特定しない集計。
          Vercel の管理画面で Web Analytics を有効にすると数え始める。
        */}
        <Analytics />
        <ErrorReporter />
      </body>
    </html>
  );
}
