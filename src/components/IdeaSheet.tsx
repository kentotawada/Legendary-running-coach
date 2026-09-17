'use client';

import { useState } from 'react';
import { IDEA_CATEGORIES } from '@/lib/suggestions';

interface Props {
  onPick: (question: string) => void;
  onClose: () => void;
}

/**
 * 何を聞けばいいか分からない時のための相談例。
 * タップすると入力欄に入るだけで、送信はしない。
 * 自分の言葉に直してから送れるようにするため。
 */
export default function IdeaSheet({ onPick, onClose }: Props) {
  const [openId, setOpenId] = useState<string>(IDEA_CATEGORIES[0].id);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/45"
      role="dialog"
      aria-modal="true"
      aria-label="相談アイデア"
    >
      <button type="button" className="flex-1" aria-label="閉じる" onClick={onClose} />

      <div className="safe-bottom max-h-[82dvh] animate-rise overflow-y-auto rounded-t-3xl border-t border-line bg-elevated">
        <div className="sticky top-0 border-b border-line bg-elevated px-5 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[16px] font-bold">コーチに聞いてみる</h2>
            <button type="button" onClick={onClose} className="rounded-full px-3 py-1.5 text-[13px] text-muted">
              閉じる
            </button>
          </div>
          <p className="mt-0.5 text-[12px] text-muted">
            タップすると入力欄に入ります。言葉を足してから送ってください。
          </p>
        </div>

        <div className="px-5 pb-8 pt-2">
          {IDEA_CATEGORIES.map((category) => {
            const open = openId === category.id;
            return (
              <section key={category.id} className="border-b border-line py-2 last:border-b-0">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? '' : category.id)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-3 py-2 text-left"
                >
                  <span aria-hidden="true" className="text-lg">
                    {category.emoji}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold">{category.title}</span>
                    <span className="block text-[12px] text-muted">{category.description}</span>
                  </span>
                  <span aria-hidden="true" className={`text-muted transition ${open ? 'rotate-180' : ''}`}>
                    ⌄
                  </span>
                </button>

                {open && (
                  <ul className="space-y-2 pb-2">
                    {category.questions.map((question) => (
                      <li key={question}>
                        <button
                          type="button"
                          onClick={() => onPick(question)}
                          className="w-full rounded-[var(--radius)] border border-line bg-bg px-3.5 py-3 text-left text-[13px] leading-relaxed transition active:scale-[0.99]"
                        >
                          {question}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
