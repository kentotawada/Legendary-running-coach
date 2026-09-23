'use client';

import { useState } from 'react';
import { IDEA_CATEGORIES } from '@/lib/suggestions';
import Sheet from './Sheet';

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
    <Sheet label="相談アイデア" title="コーチに聞いてみる" onClose={onClose}>
      <p className="-mt-1 mb-3 text-[12px] leading-relaxed text-muted">タップすると入力欄に入ります。言葉を足してから送ってください。</p>

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
    </Sheet>
  );
}
