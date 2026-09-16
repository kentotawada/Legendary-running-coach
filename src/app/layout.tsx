import type { Metadata, Viewport } from 'next';
import './globals.css';

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
      <body className="antialiased">{children}</body>
    </html>
  );
}
