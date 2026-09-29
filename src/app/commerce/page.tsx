import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Callout, LegalPage, Section } from '@/components/LegalPage';
import { commerceInfo } from '@/lib/legal';

export const metadata: Metadata = {
  title: '特定商取引法に基づく表記 | RUNCOACH',
};

/**
 * 特定商取引法に基づく表記。
 *
 * **有料にするなら、このページは任意ではない。**
 * 値段・支払う時期・解約の条件は、必ずここに出ていなければならない。
 * 値は環境変数から読む。住所や責任者名を、公開しているコードに書かないため。
 */
export default function CommercePage() {
  const info = commerceInfo();
  const rows: [string, ReactNode][] = [
    ['販売事業者', info.operator],
    ['運営統括責任者', info.manager],
    ['所在地', info.address],
    ['お問い合わせ', info.contact],
    ['販売価格', info.price],
    ['商品代金以外の必要料金', '通信料金（お客様のご負担）'],
    ['支払方法', 'クレジットカード（Stripe による決済）'],
    ['支払時期', 'お申し込み時に初回をお支払いいただき、以降は毎月同日に自動で更新します。'],
    ['提供時期', 'お支払いの完了後、ただちにご利用いただけます。'],
    [
      '解約',
      'アプリ内の「契約の管理」からいつでも解約できます。解約後も、お支払い済みの期間の終わりまでご利用いただけます。',
    ],
    [
      '返品・返金',
      'デジタルサービスの性質上、お支払い済みの期間についての返金はいたしかねます。当方の不具合により長期間ご利用いただけなかった場合は、個別に対応します。',
    ],
    ['動作環境', '最新のブラウザ（iOS Safari / Android Chrome / PC の主要ブラウザ）'],
  ];

  return (
    <LegalPage
      title="特定商取引法に基づく表記"
      lead={<p>RUNCOACH の有料プランについて、特定商取引法第11条に基づき表示します。</p>}
    >
      {info.incomplete && (
        <Callout>
          <p className="text-[14px] leading-[1.8]">
            <strong>この表記はまだ完成していません。</strong>
            環境変数 LEGAL_OPERATOR_NAME / LEGAL_ADDRESS / LEGAL_CONTACT_EMAIL / LEGAL_PRICE_TEXT
            を設定してください。すべて埋まるまで、有料プランの申し込みは受け付けません。
          </p>
        </Callout>
      )}

      <Section title="表記事項">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px] leading-relaxed">
            <tbody className="align-top">
              {rows.map(([label, value]) => (
                <tr key={label} className="border-b border-line">
                  <th className="w-[38%] py-2.5 pr-3 text-left font-medium text-muted">{label}</th>
                  <td className="py-2.5">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[13px] text-muted">
          <Link href="/terms" className="underline underline-offset-4">
            利用規約
          </Link>
          ・
          <Link href="/privacy" className="underline underline-offset-4">
            プライバシーポリシー
          </Link>
          もあわせてご確認ください。
        </p>
      </Section>
    </LegalPage>
  );
}
