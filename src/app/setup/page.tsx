import type { Metadata } from 'next';
import KeySetup from '@/components/KeySetup';

export const metadata: Metadata = {
  title: '通知の鍵を作る | RUNCOACH',
  // 運営者だけが使う画面。検索に出す意味がない。
  robots: { index: false, follow: false },
};

/**
 * 通知の鍵を作る画面。
 *
 * **運営者が、自分のスマホだけで設定を終えられるようにするためのもの。**
 * 置いてあるだけでは何も起きない（鍵を作って見せるだけで、
 * サーバーには1バイトも送らない）ので、誰が開いても害はない。
 */
export default function SetupPage() {
  return <KeySetup />;
}
