import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { coachHour, DEFAULT_TIME_ZONE } from '@/lib/day';
import { NOTIFY_HOURS } from '@/lib/nudge';

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

/**
 * 選べる時刻ごとに、その時刻の定期実行が置いてあるか。
 *
 * **画面で「21時」を選べるのに、21時に動く実行が無ければ、その人には永久に届かない。**
 * 毎時の実行が無料プランで使えないので、時刻ごとに1日1回ずつ置いている。
 * 画面の選択肢（NOTIFY_HOURS）と vercel.json がずれたら、ここで止める。
 */
describe('選べる時刻と、定期実行が揃っている', () => {
  /** UTC の「時」を、コーチの地域の「時」に直す。 */
  const localHour = (utcHour: number) =>
    coachHour(new Date(Date.UTC(2026, 0, 15, utcHour, 0, 0)), DEFAULT_TIME_ZONE);

  const covered = crons.map((cron) => localHour(Number(cron.schedule.trim().split(/\s+/)[1])));

  it('選べる時刻のどれにも、その時刻に動く実行がある', () => {
    for (const hour of NOTIFY_HOURS) {
      expect(covered, `${hour}時に動く実行が無い`).toContain(hour);
    }
  });

  it('選べない時刻に、余計な実行を置いていない', () => {
    for (const hour of covered) {
      expect(NOTIFY_HOURS as readonly number[], `${hour}時の実行は、画面で選べない`).toContain(hour);
    }
  });

  it('叩く先の目印（?at=）が、実際に動く時刻と一致している', () => {
    for (const cron of crons) {
      const at = Number(new URLSearchParams(cron.path.split('?')[1] ?? '').get('at'));
      const hour = localHour(Number(cron.schedule.trim().split(/\s+/)[1]));
      expect(at, `${cron.path} は ${hour}時に動く`).toBe(hour);
    }
  });
});
