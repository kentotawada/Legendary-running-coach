import type { Metadata } from 'next';
import { Callout, LegalPage, List, Section } from '@/components/LegalPage';

export const metadata: Metadata = {
  title: '免責事項（健康と安全について） | RUNCOACH',
};

/**
 * 免責事項。
 *
 * **ここは、法務の文章である前に、安全のための文章。**
 * いちばん大事なのは「すぐに運動をやめて医療機関へ」の一覧で、
 * だからそれを一番上に置いている。責任を逃れる文言を先に並べない。
 */
export default function DisclaimerPage() {
  return (
    <LegalPage
      title="免責事項"
      lead={<p>健康と安全についてのお願いです。RUNCOACH を安全に使っていただくために、必ずお読みください。</p>}
    >
      <Section title="すぐに運動をやめて、医療機関へ">
        <Callout tone="warn">
          <p className="text-[15px] font-bold leading-[1.8]">次のような症状がある時は、すぐに運動をやめてください。</p>
          <List>
            <li>胸の痛み、胸がしめつけられる・圧迫される感じ</li>
            <li>いつもと違う息苦しさ</li>
            <li>激しい動悸、脈の乱れ</li>
            <li>めまい、ふらつき、意識が遠のく感じ</li>
            <li>冷や汗、吐き気</li>
          </List>
          <p className="mt-3 text-[15px] font-bold leading-[1.8]">
            症状が強い時や、休んでもおさまらない時は、ためらわずに 119 番に電話してください。
          </p>
        </Callout>
      </Section>

      <Section title="このアプリは医療ではありません">
        <p>
          RUNCOACH は、ランニングの練習について助言するアプリです。<strong>病気やけがの診断・治療をするものではなく</strong>
          、医師・理学療法士などの専門家の判断に代わるものでもありません。
        </p>
      </Section>

      <Section title="痛みがある時">
        <p>
          痛みや違和感を伝えていただいた時、コーチは走らないよう案内します。ただし、それは受診が必要かどうかを判断するものではありません。
        </p>
        <p>
          痛みが続く・強くなる・腫れや熱がある・体重をかけられない、といった時は、医療機関を受診してください。
        </p>
      </Section>

      <Section title="運動を始める前に">
        <p>次にあてはまる方は、医師に相談してから始めてください。</p>
        <List>
          <li>心臓・血圧・呼吸器などに持病のある方</li>
          <li>妊娠中の方</li>
          <li>治療中の方、薬を飲んでいる方</li>
          <li>長いあいだ運動から離れていた方</li>
        </List>
      </Section>

      <Section title="数字は目安です">
        <p>
          心拍ゾーン、目標ペース、練習量などは、一般的な計算式とこれまでの記録から出した目安です。体質やその日の体調によっては合わないことがあります。
          <strong>数字より、体の感覚を優先してください。</strong>
        </p>
      </Section>

      <Section title="暑い日・寒い日">
        <p>
          気温や湿度が高い日は、熱中症の危険があります。こまめに水分と塩分をとり、無理をせず、ペースより体調を優先してください。
        </p>
      </Section>

      <Section title="AI の返答について">
        <p>
          コーチの返答は AI が作っており、誤りや不正確な内容を含むことがあります。おかしいと感じた時は、その返答に従わないでください。
        </p>
      </Section>

      <Section title="商品の紹介について">
        <p>紹介する商品には、広告（アフィリエイトリンク）が含まれることがあります。含まれる場合は、画面に表示します。</p>
      </Section>
    </LegalPage>
  );
}
