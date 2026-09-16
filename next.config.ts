import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 将来の iOS / Android 化を見据え、UI は API ルート越しにしか状態を持たない構成にしている。
  // ネイティブ側は /api/chat と /api/profile をそのまま叩けば同じコーチが動く。
  reactStrictMode: true,
};

export default nextConfig;
