import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * vercel.json の定期実行。
 *
 * **ここで間違えると、ビルドは手元で通るのに本番へ出ない。**
 * 無料プランの Vercel は「1日1回より多く動く定期実行」を受け付けず、
 * デプロイそのものを失敗させる。しかも本番は直前の成功版のまま動き続けるので、
 * 何も起きていないように見える。
 *
 * 実際に `0 * * * *`（毎時）を入れた結果、それ以降の変更が丸ごと本番に届かなかった。
 * 手元のビルドでは見つからないので、ここで止める。
 */

interface Cron {
  path: string;
  schedule: string;
}

const config = JSON.parse(readFileSync(join(__dirname, '..', 'vercel.json'), 'utf8')) as {
  crons?: Cron[];
};
const crons = config.crons ?? [];

// 「9」「0」のような、ただ1つの数。「*」「毎2時間」「1,13」は1日に何度も動く。
const SINGLE = /^\d{1,2}$/;

describe('定期実行は、無料プランで通る形にする', () => {
  it('少なくとも1つはある（通知の配信はこれに乗っている）', () => {
    expect(crons.length).toBeGreaterThan(0);
  });

  it('どれも、1日1回まで', () => {
    for (const cron of crons) {
      const fields = cron.schedule.trim().split(/\s+/);
      expect(fields, cron.schedule).toHaveLength(5);
      const [minute, hour] = fields;
      // 分と時が1つに決まっていれば、どう転んでも1日1回以下。
      expect(minute, `${cron.path}: ${cron.schedule}`).toMatch(SINGLE);
      expect(hour, `${cron.path}: ${cron.schedule}`).toMatch(SINGLE);
      expect(Number(minute)).toBeLessThan(60);
      expect(Number(hour)).toBeLessThan(24);
    }
  });

  it('叩く先は、実在する送信口', () => {
    for (const cron of crons) {
      expect(cron.path.split('?')[0]).toBe('/api/push/send');
    }
  });
});
