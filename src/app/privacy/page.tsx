import type { Metadata } from 'next';
import Link from 'next/link';
import { Callout, LegalPage, List, Section } from '@/components/LegalPage';
import { operatorInfo } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'プライバシーポリシー | RUNCOACH',
};

/**
 * プライバシーポリシー。
 *
 * **ここに書くことは、コードが実際にしていることと一致していなければならない。**
 * 預かる情報や送り先を増やしたら、ここも必ず直すこと。
 * （書いた時点で確かめたこと: 記録ファイルは端末で読み、経路は送らない /
 *  フォームの動画は端末の中だけで解析する / 楽天には検索語だけを送る /
 *  IP アドレスは日付と秘密の値で潰してから数える）
 */
export default function PrivacyPage() {
  const operator = operatorInfo();
  return (
    <LegalPage
      title="プライバシーポリシー"
      lead={
        <p>
          RUNCOACH（以下「本サービス」）の運営者（以下「運営者」）は、利用者の個人情報を次のとおり取り扱います。本サービスは、練習の記録や体の状態をもとに助言をする性質上、<strong>体に関する情報</strong>
          をお預かりします。何を預かり、どこへ送るのかを、できるだけ具体的に書いています。
        </p>
      }
    >
      <Section title="1. 運営者">
        <List>
          <li>名称：{operator.name}</li>
          <li>お問い合わせ：{operator.contact}</li>
          <li>住所・代表者名は、お問い合わせいただければ遅滞なくお答えします。</li>
        </List>
      </Section>

      <Section title="2. お預かりする情報">
        <List>
          <li>
            <strong>アカウントの情報</strong>：ログインに使うメールアドレス。
          </li>
          <li>
            <strong>プロフィール</strong>
            ：呼び名、選んだコーチ、目標、出場予定の大会、ランニング歴、自己ベスト、練習できる曜日や時間、生活上の制約、走る理由など。
          </li>
          <li>
            <strong>体に関する情報</strong>
            ：痛みや違和感の部位と程度、故障歴、体調の記録、体重、心拍数（最大・安静時・閾値）。
          </li>
          <li>
            <strong>練習の記録</strong>
            ：日付、距離、時間、ペース、心拍、ピッチ、区間ごとの数値など。時計から書き出したファイル（GPX・TCX・FIT など）は
            <strong>お使いの端末の中で読み取り</strong>
            、そこから計算した数値だけを送ります。<strong>走った経路（位置情報）は、送信も保存もしません。</strong>
          </li>
          <li>
            <strong>コーチとの会話と、送っていただいた画像</strong>
            ：会話の内容を保存します。画像は、あとから見返せるよう縮小した控えだけを保存し、元の画像は保存しません。
          </li>
          <li>
            <strong>フォームの動画</strong>：<strong>お使いの端末の中だけで</strong>
            解析します。動画を送信することも、保存することもありません。
          </li>
          <li>
            <strong>外部サービスとの連携</strong>
            ：Strava と連携した場合、連携に必要な認証の情報と、そこから取り込んだ練習の記録。
          </li>
          <li>
            <strong>通知の宛先</strong>：通知を受け取る設定にした場合、その端末に届けるための宛先の情報。
          </li>
          <li>
            <strong>利用の状況</strong>
            ：利用した回数と日時、使った量、お使いの端末やブラウザの種類。1日の利用回数の上限を守るために IP アドレスを使いますが、
            <strong>元に戻せない形に変換してから</strong>保存し、IP アドレスそのものは保存しません。
          </li>
          <li>
            <strong>端末に保存する情報</strong>
            ：ログインの状態や、同じ端末からの利用を見分けるための Cookie、文字の大きさなどの設定。
          </li>
        </List>
        <Callout>
          <p className="text-[14px] leading-[1.8]">
            体に関する情報のうち、故障歴などは、個人情報保護法で特に慎重な扱いが求められる「要配慮個人情報」にあたることがあります。
            <strong>ご本人の同意をいただいた場合にだけ</strong>お預かりします。
          </p>
        </Callout>
      </Section>

      <Section title="3. 使う目的">
        <List>
          <li>目標・体の状態・練習の記録に合わせた助言を作るため</li>
          <li>痛みや違和感がある時に、走らないよう案内するなど、安全に配慮した助言をするため</li>
          <li>記録を保存し、どの端末からでも同じ記録を見られるようにするため</li>
          <li>通知をお届けするため</li>
          <li>不正な利用を防ぎ、1日の利用回数の上限を守るため</li>
          <li>
            本サービスを改善するため（利用状況は個人を特定しない形で集計します。返答への評価「良い・良くない」とその理由は、返答の質を上げるために運営者が確認することがあります）
          </li>
          <li>お問い合わせに対応するため</li>
        </List>
      </Section>

      <Section title="4. 処理を任せている事業者（海外を含む）">
        <p>
          本サービスは、次の事業者に処理の一部を任せています。<strong>多くは日本国外（米国）の事業者です。</strong>
          本サービスを使う際に、これらの事業者へ情報が送られることに同意していただきます。
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-[13px] leading-relaxed">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th className="py-2 pr-3 font-medium">事業者（国）</th>
                <th className="py-2 pr-3 font-medium">任せていること</th>
                <th className="py-2 font-medium">送る情報</th>
              </tr>
            </thead>
            <tbody className="align-top">
              <tr className="border-b border-line">
                <td className="py-2.5 pr-3">Google LLC（米国）</td>
                <td className="py-2.5 pr-3">コーチの返答を作る（Gemini API）</td>
                <td className="py-2.5">
                  会話の内容、送った画像、返答に必要なプロフィール・体の状態・練習の記録。有料の API として利用しており、Google
                  がこれらを自社の製品の改善に使うことはありません。
                </td>
              </tr>
              <tr className="border-b border-line">
                <td className="py-2.5 pr-3">Supabase, Inc.（米国）</td>
                <td className="py-2.5 pr-3">記録の保存、ログイン</td>
                <td className="py-2.5">お預かりする情報のすべて</td>
              </tr>
              <tr className="border-b border-line">
                <td className="py-2.5 pr-3">Vercel Inc.（米国）</td>
                <td className="py-2.5 pr-3">サーバーの運用、アクセス解析</td>
                <td className="py-2.5">通信の記録、利用の状況</td>
              </tr>
              <tr className="border-b border-line">
                <td className="py-2.5 pr-3">Strava, Inc.（米国）</td>
                <td className="py-2.5 pr-3">練習の取り込み（連携した場合のみ）</td>
                <td className="py-2.5">連携のための認証の情報</td>
              </tr>
              <tr className="border-b border-line">
                <td className="py-2.5 pr-3">Apple Inc.・Google LLC など（米国）</td>
                <td className="py-2.5 pr-3">通知の配信（受け取る設定にした場合のみ）</td>
                <td className="py-2.5">通知の文面</td>
              </tr>
              <tr>
                <td className="py-2.5 pr-3">楽天グループ株式会社（日本）</td>
                <td className="py-2.5 pr-3">紹介する商品の検索</td>
                <td className="py-2.5">検索する言葉のみ（個人の情報は送りません）</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          音声入力は、お使いの端末・ブラウザの音声認識の機能を使います。音声は、その提供元（Apple・Google
          など）の仕組みで処理されます。
        </p>
        <p>
          米国の個人情報の保護に関する制度については、個人情報保護委員会が公表している「外国における個人情報の保護に関する制度等の調査」をご覧ください。上記の各事業者は、個人情報の保護に関する方針を定め、安全管理のための措置を講じています。
        </p>
        <p>上記のほかは、法令に基づく場合を除き、ご本人の同意なく第三者に個人情報を提供しません。</p>
      </Section>

      <Section title="5. 安全のための措置">
        <List>
          <li>通信はすべて暗号化しています（HTTPS）。</li>
          <li>保存先にはサーバーからしか書き込めず、他の利用者の記録を読むことはできない仕組みにしています。</li>
          <li>外部サービスの認証の情報や通知の宛先は、画面にも返しません。</li>
          <li>IP アドレスは、元に戻せない形に変換してから扱います。</li>
        </List>
      </Section>

      <Section title="6. 保存する期間">
        <List>
          <li>
            記録は、消去されるまで保存します。カルテの一番下にある「記録をすべて消去する」から、いつでもご自身で消せます。
          </li>
          <li>ログインに使うアカウント（メールアドレス）の削除をご希望の場合は、お問い合わせください。</li>
          <li>利用回数の集計は、運用に必要な期間保存します。</li>
        </List>
      </Section>

      <Section title="7. 開示・訂正・利用停止・消去の請求">
        <p>
          お預かりしている情報は、カルテで確認・修正・消去できます。そのほかの請求は、お問い合わせください。ご本人であることを確認したうえで、法令に従って対応します。
        </p>
      </Section>

      <Section title="8. 未成年の方">
        <p>18歳未満の方は、保護者の方の同意を得てからご利用ください。</p>
      </Section>

      <Section title="9. Cookie とアクセス解析">
        <p>
          ログインの状態を保つためと、同じ端末からの利用を見分けるために Cookie を使います。アクセス解析には Vercel Web Analytics
          を使います。これは Cookie を使わず、個人を特定しない形で集計する仕組みです。
        </p>
      </Section>

      <Section title="10. このポリシーの変更">
        <p>
          内容を変えることがあります。大きく変える時は、アプリの中でお知らせし、あらためて同意をいただきます。
        </p>
      </Section>

      <Section title="11. お問い合わせ">
        <p>{operator.contact}</p>
        <p className="text-[13px] text-muted">
          <Link href="/terms" className="underline underline-offset-4">
            利用規約
          </Link>
          ・
          <Link href="/disclaimer" className="underline underline-offset-4">
            免責事項
          </Link>
          もあわせてご確認ください。
        </p>
      </Section>
    </LegalPage>
  );
}
