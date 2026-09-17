import { describe, expect, it } from 'vitest';
import { IDEA_CATEGORIES } from '@/lib/suggestions';

describe('相談アイデア', () => {
  it('依頼された3つのカテゴリを備えている', () => {
    const titles = IDEA_CATEGORIES.map((c) => c.title);
    expect(titles).toContain('食事・補給');
    expect(titles).toContain('睡眠・疲労');
    expect(titles).toContain('コンディショニング');
  });

  it('どのカテゴリにも質問が入っている', () => {
    for (const category of IDEA_CATEGORIES) {
      expect(category.questions.length).toBeGreaterThanOrEqual(4);
      for (const question of category.questions) {
        expect(question.trim().length).toBeGreaterThan(10);
      }
    }
  });

  it('id が重複していない', () => {
    const ids = IDEA_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('質問が重複していない', () => {
    const questions = IDEA_CATEGORIES.flatMap((c) => c.questions);
    expect(new Set(questions).size).toBe(questions.length);
  });

  it('カルテを見ないと答えられない聞き方になっている', () => {
    // 「ランニングとは」のような一般論で終わる質問を置かないための歯止め。
    const questions = IDEA_CATEGORIES.flatMap((c) => c.questions);
    const personal = questions.filter((q) => /私|自分|今|この|直近|今週|明日|本番|レース/.test(q));
    expect(personal.length / questions.length).toBeGreaterThan(0.8);
  });
});
