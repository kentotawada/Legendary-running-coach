import { describe, expect, it } from 'vitest';
import { COACH_TOOL_NAMES, extractTextToolCalls, stripToolTextForDisplay } from '@/lib/tool-text';
import { coachTools } from '@/lib/tools';

describe('ツール名の一覧', () => {
  it('実際の宣言と一致している', () => {
    expect([...COACH_TOOL_NAMES].sort()).toEqual(coachTools.map((t) => t.name).sort());
  });
});

describe('本文に書かれたツール呼び出し', () => {
  const sample = `明日はここから始めましょう。

set_today_plan
{
  "title": "明日の朝：20分間のイージーラン",
  "steps": ["起床後、コップ一杯の水を飲む", "20分走る"],
  "rationale": "朝の体温が低い状態から安全に心拍を上げるため",
  "intensity": "easy"
}

無理のない範囲でいきましょう。`;

  it('画面に出さず、本文だけを残す', () => {
    const { cleaned } = extractTextToolCalls(sample);

    expect(cleaned).toContain('明日はここから始めましょう。');
    expect(cleaned).toContain('無理のない範囲でいきましょう。');
    expect(cleaned).not.toContain('set_today_plan');
    expect(cleaned).not.toContain('"intensity"');
  });

  it('取り出した内容は、実行できる形で返す', () => {
    const { calls } = extractTextToolCalls(sample);

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('set_today_plan');
    expect((calls[0].args as { title: string }).title).toContain('イージーラン');
  });

  it('生成途中でも JSON を画面に出さない', () => {
    const partial = 'では記録します。\n\nlog_activity\n{\n  "type": "run",\n  "distanc';
    const { cleaned, truncated } = extractTextToolCalls(partial);

    expect(truncated).toBe(true);
    expect(cleaned).toBe('では記録します。');
    expect(cleaned).not.toContain('log_activity');
  });

  it('バッククォートや記号で装飾されていても取り除く', () => {
    const decorated = '記録します。\n\n`log_weight`\n{"weightKg": 61.4}\n\nお疲れさまでした。';
    const { cleaned, calls } = extractTextToolCalls(decorated);

    expect(cleaned).not.toContain('log_weight');
    expect(cleaned).not.toContain('61.4');
    expect(calls[0].name).toBe('log_weight');
  });

  it('複数あっても全部取り除く', () => {
    const many = [
      'まず記録します。',
      'log_activity',
      '{"type":"run","distanceKm":10}',
      'そして明日の予定です。',
      'set_today_plan',
      '{"title":"休養","steps":["休む"],"rationale":"疲労","intensity":"rest"}',
      '以上です。',
    ].join('\n\n');
    const { cleaned, calls } = extractTextToolCalls(many);

    expect(calls.map((c) => c.name)).toEqual(['log_activity', 'set_today_plan']);
    expect(cleaned).toBe('まず記録します。\n\nそして明日の予定です。\n\n以上です。');
  });

  it('文字列の中に波括弧があっても、正しい位置で閉じる', () => {
    const tricky = 'log_condition\n{"note":"気分は {良好} です","fatigue":2}\n\n続きです。';
    const { cleaned, calls } = extractTextToolCalls(tricky);

    expect((calls[0].args as { note: string }).note).toBe('気分は {良好} です');
    expect(cleaned).toBe('続きです。');
  });

  it('会話の中でツール名に触れただけなら、本文を壊さない', () => {
    // JSON が続かない限り、ただの単語として扱う。
    const mention = 'log_activity という機能で記録しています。';
    expect(stripToolTextForDisplay(mention)).toBe(mention);
  });

  it('普通の返答には手を触れない', () => {
    const normal = '今日はよく走れましたね。明日は休みましょう。';
    const { cleaned, calls } = extractTextToolCalls(normal);

    expect(cleaned).toBe(normal);
    expect(calls).toHaveLength(0);
  });
});
