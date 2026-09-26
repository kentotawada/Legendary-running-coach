'use client';

import { useState } from 'react';
import Sheet from './Sheet';

export interface AuthState {
  /** Supabase が設定されているか。未設定ならログイン機能そのものが出ない。 */
  available: boolean;
  isAuthenticated: boolean;
  email?: string;
}

interface Props {
  auth: AuthState;
  onClose: () => void;
  /** カルテから開かれた時だけ渡す。閉じたらカルテへ戻す。 */
  onBack?: () => void;
  onSignedOut: () => void;
}

export default function AuthSheet({ auth, onClose, onBack, onSignedOut }: Props) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const sendLink = async () => {
    setSending(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'ログインリンクを送れませんでした。');
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ログインリンクを送れませんでした。');
    } finally {
      setSending(false);
    }
  };

  const signOut = async () => {
    await fetch('/api/auth/signout', { method: 'POST' });
    onSignedOut();
  };

  return (
    <Sheet
      label="アカウント"
      title="アカウント"
      onClose={onClose}
      onBack={onBack}
      backLabel={onBack ? 'カルテ' : undefined}
    >

          {!auth.available ? (
            <p className="text-[13px] leading-relaxed text-muted">
              ログイン機能は設定されていません。現在の記録はこの端末にのみ保存されています。
            </p>
          ) : auth.isAuthenticated ? (
            <>
              <p className="text-[13px] leading-relaxed">
                <span className="font-semibold">{auth.email ?? 'ログイン済み'}</span> でログインしています。
                <span className="mt-1 block text-muted">
                  カルテと会話は、どの端末から開いても同じものが表示されます。
                </span>
              </p>
              <button
                type="button"
                onClick={() => void signOut()}
                className="mt-4 w-full rounded-full border border-line px-4 py-3 text-[14px]"
              >
                ログアウト
              </button>
            </>
          ) : (
            <>
              <p className="text-[13px] leading-relaxed">
                いまの記録は<strong className="font-semibold">この端末にのみ</strong>保存されています。
                <span className="mt-1 block text-muted">
                  ログインすると、これまでのカルテと会話がそのまま引き継がれ、
                  機種変更やブラウザの変更でも消えなくなります。
                </span>
              </p>

              <a
                href="/api/auth/google"
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-line bg-bg px-4 py-3 text-[14px] font-semibold"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                  <path fill="#4285F4" d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7C21.8 18.9 23 15.9 23 12.3z" />
                  <path fill="#34A853" d="M12 23.5c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3C3.7 20.9 7.6 23.5 12 23.5z" />
                  <path fill="#FBBC05" d="M5.6 14.2a6.9 6.9 0 0 1 0-4.4v-3H1.8a11.5 11.5 0 0 0 0 10.4l3.8-3z" />
                  <path fill="#EA4335" d="M12 5.1c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.7 1.6 15.1.5 12 .5 7.6.5 3.7 3.1 1.8 6.8l3.8 3C6.5 7.1 9 5.1 12 5.1z" />
                </svg>
                Googleでログイン
              </a>

              <div className="my-4 flex items-center gap-3 text-[12px] text-muted">
                <span className="h-px flex-1 bg-[color:var(--border)]" />
                または
                <span className="h-px flex-1 bg-[color:var(--border)]" />
              </div>

              {sent ? (
                <div className="rounded-[var(--radius)] border border-[color:var(--good)] bg-good-soft px-4 py-3 text-[13px] leading-relaxed text-good">
                  <strong className="font-semibold">{email.trim()}</strong> にログイン用のリンクを送りました。
                  メールを開いてリンクをタップすると、ログインが完了します。
                </div>
              ) : (
                <>
                  <label className="block text-[13px] font-medium" htmlFor="auth-email">
                    メールアドレスでログイン
                  </label>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                    パスワードは要りません。届いたリンクをタップするだけです。
                  </p>
                  <div className="mt-2 flex gap-2">
                    <input
                      id="auth-email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 py-2.5 text-fg outline-none focus:border-[color:var(--accent)]"
                    />
                    <button
                      type="button"
                      disabled={!valid || sending}
                      onClick={() => void sendLink()}
                      className="shrink-0 rounded-full bg-accent px-5 py-2.5 text-[14px] font-semibold text-[var(--accent-fg)] disabled:opacity-40"
                    >
                      {sending ? '送信中' : '送る'}
                    </button>
                  </div>
                </>
              )}

              {error && <p className="mt-3 text-[13px] leading-relaxed text-warn">{error}</p>}
            </>
          )}
    </Sheet>
  );
}
