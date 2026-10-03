import Link from 'next/link';
import { LEGAL_EFFECTIVE_DATE, operatorInfo } from '@/lib/legal';

/**
 * 規約・プライバシーポリシー・免責事項の共通の枠。
 *
 * **読まれる文章にする。** 法務の文章は、読まれないのが前提で書かれがちだが、
 * このアプリは体の情報を預かる。何を預かって、どこへ送るのかは、
 * 実際に読んで分かる形でなければ、同意を取った意味が無い。
 */

export const LEGAL_LINKS = [
  { href: '/terms', label: '利用規約' },
  { href: '/privacy', label: 'プライバシーポリシー' },
  { href: '/disclaimer', label: '免責事項' },
] as const;

export function LegalPage({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: React.ReactNode;
  children: React.ReactNode;
}) {
  const operator = operatorInfo();
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <div className="mx-auto max-w-[680px] px-4 pb-16 pt-6">
        <Link href="/" className="inline-flex items-center gap-2" aria-label="RUNCOACH に戻る">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="" width={28} height={28} className="rounded-[8px]" />
          <span className="t-body font-bold tracking-[0.12em]">RUNCOACH</span>
        </Link>

        <h1 className="mt-8 text-balance t-num font-bold leading-snug">{title}</h1>
        <p className="mt-1 t-note text-muted">制定日：{LEGAL_EFFECTIVE_DATE}</p>

        {operator.incomplete && (
          // 公開前に埋める項目が残っている時だけ出す。**埋めずに公開しないため。**
          <p className="mt-4 rounded-[12px] border border-[color:var(--warn)] bg-warn-soft px-3.5 py-3 t-note leading-relaxed text-warn">
            運営者名または連絡先が設定されていません。公開前に、Vercel の環境変数
            LEGAL_OPERATOR_NAME と LEGAL_CONTACT_EMAIL を設定してください。
          </p>
        )}

        {lead && <div className="mt-6 t-body leading-[1.9]">{lead}</div>}

        <div className="mt-2">{children}</div>

        <footer className="mt-14 border-t border-line pt-6 t-note leading-relaxed text-muted">
          <p>
            運営者：{operator.name}
            <br />
            お問い合わせ：{operator.contact}
          </p>
          <nav className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
            {LEGAL_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="text-fg underline underline-offset-4">
                {link.label}
              </Link>
            ))}
            <Link href="/" className="text-fg underline underline-offset-4">
              アプリに戻る
            </Link>
          </nav>
        </footer>
      </div>
    </div>
  );
}

/** 見出しと本文のひとまとまり。 */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="t-body font-bold leading-snug">{title}</h2>
      <div className="mt-3 space-y-3 t-body leading-[1.9]">{children}</div>
    </section>
  );
}

export function List({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5 marker:text-muted">{children}</ul>;
}

/** 読み飛ばしてほしくない一文。 */
export function Callout({ children, tone = 'accent' }: { children: React.ReactNode; tone?: 'accent' | 'warn' }) {
  const colors =
    tone === 'warn'
      ? 'border-[color:var(--warn)] bg-warn-soft'
      : 'bg-accent-soft';
  return <div className={`rounded-[14px] border px-4 py-3.5 ${colors}`}>{children}</div>;
}
