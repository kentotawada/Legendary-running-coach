import { describe, expect, it } from 'vitest';
import { LADDER_RULES, areaOf, comebackDoctrine, comebackPlan } from '@/lib/comeback';
import { findFigure } from '@/lib/figures';
import { createDefaultProfile } from '@/lib/types';
import type { RunnerProfile } from '@/lib/types';

/**
 * 走れない日の、その先。
 *
 * **止めるのは半分でしかない。** 止めた人が次に知りたいのは、
 * 代わりに何をするか・いつ戻れるか・どうなったら病院か、の3つ。
 *
 * ここで絶対にやらないのは、診断することと、日数で「戻れる」と言うこと。
 */

const NOW = new Date('2026-10-02T07:00:00+09:00');

function dateDaysAgo(days: number): string {
  const d = new Date('2026-10-02T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function hurt(site: string, sinceDaysAgo = 3, severity = 2): RunnerProfile {
  return {
    ...createDefaultProfile('u1', '2026-06-01T00:00:00.000Z'),
    pains: [
      {
        id: 'p1',
        site,
        severity,
        status: 'active',
        since: dateDaysAgo(sinceDaysAgo),
        updatedAt: `${dateDaysAgo(1)}T10:00:00.000Z`,
      },
    ],
  };
}

describe('痛む場所の見分け', () => {
  it('言葉から、おおまかな区分にする', () => {
    expect(areaOf('右膝の外側')).toBe('knee');
    expect(areaOf('左アキレス腱')).toBe('achilles');
    expect(areaOf('すねの内側')).toBe('shin');
    expect(areaOf('ふくらはぎ')).toBe('calf');
    expect(areaOf('足底')).toBe('foot');
    expect(areaOf('股関節の前')).toBe('hip');
    expect(areaOf('ハムストリング')).toBe('thigh');
    expect(areaOf('腰')).toBe('back');
  });

  /** 外れても害が出ない使い方しかしないので、分からない時は 'other' で止める。 */
  it('分からない言葉は、無理に当てはめない', () => {
    expect(areaOf('なんとなく体が痛い')).toBe('other');
    expect(areaOf('')).toBe('other');
  });
});

describe('代わりにやること', () => {
  it('走れない時だけ出す', () => {
    expect(comebackPlan(createDefaultProfile('u1'), NOW)).toBeNull();
    expect(comebackPlan(hurt('右膝の外側'), NOW)).not.toBeNull();
  });

  /**
   * **部位によって、やってはいけないものがある。**
   * 「何でもいいから有酸素を」は、いちばん無責任な助言。
   */
  it('膝には、体重がかからないものを出す', () => {
    const plan = comebackPlan(hurt('右膝の外側'), NOW)!;
    expect(plan.instead.map((item) => item.label)).toContain('水中を歩く');
  });

  it('アキレス腱には、自転車を無条件に勧めない', () => {
    const plan = comebackPlan(hurt('左アキレス腱'), NOW)!;
    const bike = plan.instead.find((item) => item.label.includes('自転車'));
    expect(bike?.label).toContain('慎重');
    expect(bike?.detail).toContain('かかと');
  });

  it('すねは、まず休ませる', () => {
    const plan = comebackPlan(hurt('すねの内側'), NOW)!;
    expect(plan.instead[0].label).toBe('まず休む');
    expect(plan.instead[0].detail).toContain('骨');
  });

  it('肉離れの直後に、強く伸ばさせない', () => {
    const plan = comebackPlan(hurt('右のハムストリング'), NOW)!;
    expect(plan.instead.some((item) => item.label.includes('強く伸ばさない'))).toBe(true);
  });

  it('図の id は、実在するものだけ', () => {
    for (const site of ['右膝', 'すね', 'アキレス腱', 'ふくらはぎ', '足底', '股関節', 'もも裏', '腰', 'どこか']) {
      for (const item of comebackPlan(hurt(site), NOW)!.instead) {
        if (item.figureId) expect(findFigure(item.figureId)).toBeTruthy();
      }
    }
  });
});

describe('走りに戻るまで', () => {
  /** **日数で区切らない。**「2週間休めば戻れる」は誰にも言えない。 */
  it('段ごとの条件は、日数ではなく痛みで書く', () => {
    const plan = comebackPlan(hurt('右膝の外側'), NOW)!;

    expect(plan.stages).toHaveLength(5);
    expect(plan.stages[0].title).toContain('痛みを引かせる');
    expect(plan.stages[4].what).toContain('ポイント練習はいちばん最後');
    for (const stage of plan.stages) {
      expect(stage.next).not.toMatch(/\d+日(で|たてば|後)/);
    }
  });

  it('戻るのは失敗ではない、と書いてある', () => {
    expect(LADDER_RULES.join('')).toContain('戻るのは失敗ではなく');
    expect(LADDER_RULES.join('')).toContain('その場で止める');
  });

  it('いきなり元の量へ戻させない', () => {
    const plan = comebackPlan(hurt('右膝の外側'), NOW)!;
    expect(plan.stages[4].what).toContain('半分');
  });
});

describe('病院のこと', () => {
  /** **受診を遠ざけない。** */
  it('目安をはっきり並べる', () => {
    const plan = comebackPlan(hurt('右膝の外側'), NOW)!;
    const all = plan.seeDoctor.join('');

    expect(all).toContain('2週間');
    expect(all).toContain('腫れ');
    expect(all).toContain('夜');
    expect(all).toContain('一点を押すと');
  });

  it('2週間を超えたら、受診を前に出す', () => {
    expect(comebackPlan(hurt('右膝の外側', 20), NOW)!.note).toContain('一度みてもらう');
    expect(comebackPlan(hurt('右膝の外側', 3), NOW)!.note).not.toContain('一度みてもらう');
  });

  it('何日目かを数える', () => {
    expect(comebackPlan(hurt('右膝の外側', 5), NOW)!.daysSince).toBe(5);
  });
});

describe('画面に出す文字', () => {
  /** 地の文として出すので、記号が混ざるとそのまま文字で見える。 */
  it('記号を混ぜない', () => {
    const plan = comebackPlan(hurt('右膝の外側', 20), NOW)!;
    const all = [
      plan.note,
      ...plan.seeDoctor,
      ...LADDER_RULES,
      ...plan.instead.map((item) => `${item.label}${item.detail}`),
      ...plan.stages.map((stage) => `${stage.title}${stage.what}${stage.next}`),
    ].join('');
    expect(all).not.toContain('**');
  });
});

describe('プロンプトに差し込む段取り', () => {
  it('画面に出ているものを、そのまま知らせる', () => {
    const text = comebackDoctrine(hurt('右膝の外側'), NOW)!;

    expect(text).toContain('本人はもう見ている');
    expect(text).toContain('右膝の外側');
    expect(text).toContain('診断しないこと');
    expect(text).toContain('日数で「いつ戻れる」と言わないこと');
  });

  it('2週間を超えていたら、受診に触れさせる', () => {
    expect(comebackDoctrine(hurt('右膝の外側', 20), NOW)).toContain('今日の会話で一度は受診に触れる');
  });

  it('走れる人には、何も載せない', () => {
    expect(comebackDoctrine(createDefaultProfile('u1'), NOW)).toBeNull();
  });
});
