import { cleanEnv } from './build-info';

/**
 * ログイン後に戻ってくる先。
 * Vercel のプレビューURLはデプロイごとに変わるので、
 * 設定値が無ければリクエスト元のオリジンを使う。
 */
export function siteOrigin(request: Request): string {
  const configured = cleanEnv(process.env.NEXT_PUBLIC_SITE_URL);
  if (configured) return configured.replace(/\/$/, '');

  // プロキシ越しでも正しいオリジンになるよう、転送ヘッダを優先する。
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedHost) return `${forwardedProto ?? 'https'}://${forwardedHost}`;

  return new URL(request.url).origin;
}
