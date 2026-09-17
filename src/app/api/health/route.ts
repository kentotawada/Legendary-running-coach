import { getBuildInfo } from '@/lib/build-info';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 設定の確認用。ブラウザでそのまま開ける。
 * API キーの値は返さない。設定されているか、形が正しそうかだけを返す。
 */
export async function GET() {
  return Response.json(
    { ok: true, checkedAt: new Date().toISOString(), ...getBuildInfo() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
