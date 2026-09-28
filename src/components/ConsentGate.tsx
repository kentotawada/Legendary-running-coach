'use client';

import { useState } from 'react';
import ConsentCheck from './ConsentCheck';

/**
 * すでに使っている人に、規約への同意をお願いする画面。
 *
 * 規約ができる前から使っている人と、規約の版が上がった後に開いた人に出る。
 * **同意しない人を、行き止まりに置かない。** 預けた記録を消して離れる道を、同じ画面に用意する。
 * 同意しないと使えないのに、記録を消す手段がカルテの奥（＝同意の先）にしか無いのでは、筋が通らない。
 */
export default function ConsentGate({
  busy = false,
  onAgree,
  onErase,
}: {
  busy?: boolean;
  onAgree: () => void;
  onErase: () => void;
}) {
  const [agreed, setAgreed] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <div className="flex-1 overflow-y-auto px-4 pb-4 pt-8">
        <div className="mb-6 flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="" width={32} height={32} className="rounded-[9px]" />
          <span className="text-[15px] font-bold tracking-[0.12em]">RUNCOACH</span>
        </div>

        <h1 className="text-[22px] font-bold leading-snug">利用規約とプライバシーポリシーへの同意のお願い</h1>
        <p className="mt-3 text-[14px] leading-[1.9]">
          RUNCOACH は、痛み・故障歴・体重・心拍といった、<strong>体に関する記録</strong>
          をお預かりしています。その扱いを、利用規約・プライバシーポリシー・免責事項にまとめました。
        </p>
        <p className="mt-3 text-[14px] leading-[1.9]">
          コーチの返答を作るために、会話の内容を海外（米国）の事業者に送っていることも書いています。続けて使うには、内容を確かめて同意してください。
        </p>

        <ul className="mt-5 space-y-2 text-[14px]">
          {[
            { href: '/terms', label: '利用規約' },
            { href: '/privacy', label: 'プライバシーポリシー' },
            { href: '/disclaimer', label: '免責事項（健康と安全について）' },
          ].map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                target="_blank"
                rel="noopener"
                className="flex items-center justify-between rounded-[12px] border border-line px-4 py-3 font-medium"
              >
                {link.label}
                <span aria-hidden className="text-muted">
                  ›
                </span>
              </a>
            </li>
          ))}
        </ul>

        <p className="mt-8 text-[12px] leading-relaxed text-muted">
          同意しない場合は、ここでこれまでの記録を消去できます。<button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm('会話とカルテをすべて消去します。この操作は取り消せません。消去しますか？')) onErase();
            }}
            className="ml-1 font-medium text-warn underline underline-offset-2 disabled:opacity-40"
          >
            記録をすべて消去する
          </button>
        </p>
      </div>

      <div className="border-t border-line bg-bg px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mb-3">
          <ConsentCheck checked={agreed} onChange={setAgreed} />
        </div>
        <button
          type="button"
          disabled={!agreed || busy}
          onClick={onAgree}
          className="w-full rounded-full bg-accent py-3.5 text-[15px] font-bold text-[var(--accent-fg)] disabled:opacity-40"
        >
          {busy ? '保存しています…' : '同意して続ける'}
        </button>
      </div>
    </div>
  );
}
