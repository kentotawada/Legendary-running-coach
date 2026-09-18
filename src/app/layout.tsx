import type { Metadata, Viewport } from 'next';
import './globals.css';
import { FONT_SIZE_BOOT_SCRIPT } from '@/lib/display';

export const metadata: Metadata = {
  title: '伝説のランニングコーチ',
  description:
    'あなたの目的・体調・生活の変化を学び続け、その瞬間に最適な一手を出し続ける、あなただけのパーソナルコーチ。',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: '伝説のコーチ',
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
    { media: '(prefers-color-scheme: light)', color: '#f7f5f2' },
    { media: '(prefers-color-scheme: dark)', color: '#14120f' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        {/*
          文字サイズは描画の前に当てる。読み込んでから切り替えると、
          大きい設定にしている人の画面が毎回一瞬だけ小さく見えてしまう。
        */}
        <script dangerouslySetInnerHTML={{ __html: FONT_SIZE_BOOT_SCRIPT }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
