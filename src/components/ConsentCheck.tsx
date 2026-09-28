'use client';

/**
 * 規約への同意のチェック。最初の画面と、規約が変わった時の画面で使う。
 *
 * **チェックの文言に「体の情報を預ける」ことを、はっきり書く。**
 * 規約へのリンクを並べただけでは、痛みや体重を預けることに同意したとは言いにくい。
 * 預かるものを、同意する文そのものに書いておく。
 */
export default function ConsentCheck({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const link = 'font-medium text-fg underline underline-offset-2';
  return (
    <div>
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-[3px] h-[18px] w-[18px] shrink-0 accent-[color:var(--accent)]"
        />
        <span className="text-[12px] leading-relaxed text-muted">
          <a href="/terms" target="_blank" rel="noopener" className={link}>
            利用規約
          </a>
          ・
          <a href="/privacy" target="_blank" rel="noopener" className={link}>
            プライバシーポリシー
          </a>
          ・
          <a href="/disclaimer" target="_blank" rel="noopener" className={link}>
            免責事項
          </a>
          に同意します。痛み・故障歴・体重・心拍など、<strong className="font-semibold text-fg">体に関する記録を預けること</strong>
          にも同意します。
        </span>
      </label>
      {/* 同意の横に、いちばん大事な一文を置く。規約を開かない人にも、これだけは届くように。 */}
      <p className="mt-2 pl-[28px] text-[11px] leading-relaxed text-muted">
        医療の代わりにはなりません。胸の痛みや息苦しさがある時は、すぐに運動をやめて医療機関へ。
      </p>
    </div>
  );
}
