import { describe, expect, it } from 'vitest';
import {
  CONNECT_SOURCES,
  detectSource,
  effortLabel,
  findSource,
  mergeSources,
  needsSetup,
  type SourceId,
} from '@/lib/connections';

describe('選べる道具の一覧', () => {
  it('id が重複しない', () => {
    const ids = CONNECT_SOURCES.map((source) => source.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('日本のランナーが実際に使う道具が入っている', () => {
    const ids = CONNECT_SOURCES.map((source) => source.id);
    for (const id of ['garmin', 'apple-watch', 'nike', 'coros', 'polar', 'suunto', 'adidas']) {
      expect(ids).toContain(id);
    }
  });

  /**
   * 手順が空の選択肢を押すと、何も出ない箱が開く。
   * 「押したのに何も起きない」が、いちばん諦められる壊れ方なので、ここで止める。
   */
  it('作業が残る道具には、必ず手順がある', () => {
    for (const source of CONNECT_SOURCES) {
      if (source.route === 'direct') continue;
      expect(source.steps.length, source.id).toBeGreaterThan(0);
    }
  });

  it('作業が要らない道具だけが0分を名乗る', () => {
    for (const source of CONNECT_SOURCES) {
      if (source.route === 'direct') expect(source.minutes, source.id).toBe(0);
      else expect(source.minutes, source.id).toBeGreaterThan(0);
    }
  });

  it('Strava の中でリンクする道具は、その項目名を手順に持つ', () => {
    for (const source of CONNECT_SOURCES.filter((item) => item.route === 'link')) {
      const text = source.steps.map((step) => step.title).join('\n');
      expect(text, source.id).toContain('アプリ、サービス、デバイスをリンク');
    }
  });

  /**
   * 公式の窓口が無いサービスを、あるかのように書かない。
   * 「手順どおりにやったのに一覧に無い」で詰まらせないため、先に断っておく。
   */
  it('橋渡しが要る道具は、なぜ一手増えるのかを先に断っている', () => {
    for (const source of CONNECT_SOURCES.filter((item) => item.route === 'bridge')) {
      expect(source.caution, source.id).toBeTruthy();
    }
  });

  it('手順の説明は、画面の表示名か操作で書かれている', () => {
    for (const source of CONNECT_SOURCES) {
      for (const step of source.steps) {
        expect(step.title.length, `${source.id}: ${step.title}`).toBeGreaterThan(4);
      }
    }
  });
});

describe('届いた記録の出どころ', () => {
  it('Garmin の自動連携を見分ける', () => {
    expect(detectSource('garmin_push_1234567890')).toBe('garmin');
    expect(detectSource('Garmin Forerunner 965')).toBe('garmin');
  });

  it('他社の時計・アプリも見分ける', () => {
    expect(detectSource('coros-abc')).toBe('coros');
    expect(detectSource('Polar Vantage V3')).toBe('polar');
    expect(detectSource('suunto_9')).toBe('suunto');
    expect(detectSource('nike-run-club-xyz')).toBe('nike');
    expect(detectSource('runtastic_123')).toBe('adidas');
  });

  it('橋渡しアプリを通った記録は、ヘルスケア経由として扱う', () => {
    expect(detectSource('healthfit-2026-09-24')).toBe('apple-watch');
    expect(detectSource('Apple Watch Series 10')).toBe('apple-watch');
  });

  /**
   * ここが曖昧なままだと、「Garmin なのに Strava と表示される」が起きる。
   * 一覧の順が変わっても、時計の名前が先に立つことを固定する。
   */
  it('Strava で開いた Garmin の記録は、Garmin と判定する', () => {
    expect(detectSource('garmin_push_9 Strava iPhone App')).toBe('garmin');
  });

  it('手がかりが無い時は、分からないと答える', () => {
    expect(detectSource(undefined)).toBeUndefined();
    expect(detectSource('')).toBeUndefined();
    expect(detectSource('   ')).toBeUndefined();
    // 知らない名前を、それらしい道具に当てはめない。
    expect(detectSource('my-own-tracker-v2')).toBeUndefined();
  });
});

describe('出どころの積み上げ', () => {
  it('同じ出どころを重ねて持たない', () => {
    expect(mergeSources(['garmin'], ['garmin', 'strava'])).toEqual(['garmin', 'strava']);
  });

  /**
   * 今回たまたま Garmin の記録が無くても、Garmin の設定がほどけたわけではない。
   * 一度確認できた出どころを消すと、済んだ手順がまた画面に戻ってくる。
   */
  it('今回見つからなかった出どころを、消さない', () => {
    expect(mergeSources(['garmin'], [])).toEqual(['garmin']);
  });

  it('何も知らない状態からでも足せる', () => {
    expect(mergeSources(undefined, ['polar'])).toEqual(['polar']);
  });
});

describe('残り作業の伝え方', () => {
  const garmin = findSource('garmin')!;
  const strava = findSource('strava')!;

  it('記録が届いている道具は、もう作業が無い', () => {
    expect(needsSetup(garmin, ['garmin'])).toBe(false);
    expect(effortLabel(garmin, ['garmin'])).toBe('もう届いています');
  });

  it('届いていない道具は、かかる手間を先に出す', () => {
    expect(needsSetup(garmin, [])).toBe(true);
    expect(effortLabel(garmin, [])).toContain('一度だけ');
    expect(effortLabel(garmin, [])).toContain('3分');
  });

  it('Strava で記録している人には、そもそも作業が無い', () => {
    expect(needsSetup(strava, [])).toBe(false);
    // まだつないでいない人に「もう届いています」と言わない。
    expect(effortLabel(strava, [])).toBe('追加の設定なし');
  });

  it('別の道具が届いていても、この道具が済んだことにはしない', () => {
    expect(needsSetup(garmin, ['nike'] as SourceId[])).toBe(true);
  });
});

describe('選択肢の引き当て', () => {
  it('知らない id には何も返さない', () => {
    expect(findSource('garmin')?.name).toBe('Garmin の時計');
    expect(findSource('unknown')).toBeUndefined();
    expect(findSource(undefined)).toBeUndefined();
  });
});
