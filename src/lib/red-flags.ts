/**
 * 走っている人の「危険な兆候」。
 *
 * **痛みの仕組み（safety.ts）は、筋肉や関節のためのもの。** 膝が痛ければ走らせない。
 * だが胸の痛み・意識が遠のく感じ・ろれつが回らない、は種類が違う。
 * 心臓・脳・呼吸の兆候かもしれず、「休めば治る」では済まないことがある。
 * これまで、コーチはこれを拾えず、受診も 119 番も言わないまま練習の話を続けうる作りだった。
 *
 * 作りは痛みと同じく、**モデルの言い回しに頼らず、コードで担保する。**
 *  1. 届いた文章から、コードで兆候を拾う（ここ）
 *  2. 拾ったら、指示文の先頭に強制の指示を差し込む（事前）
 *  3. 返答に「やめる・119・受診」が無ければ、決まった文言をコードで足す（事後）
 *  4. 記録に残し、診てもらったと分かるまで練習を出さない（次の日以降も）
 *
 * **拾いすぎは許す。拾い漏らしは許さない。** 「胸が痛む話」のような言い回しで
 * 注意書きが出ても害は小さいが、本物を見逃した時の害は取り返しがつかない。
 */

import type { RedFlagLevel, RedFlagRecord, RunnerProfile } from './types';

export type { RedFlagLevel, RedFlagRecord };

export interface RedFlag {
  /** いちばん重いもの。 */
  level: RedFlagLevel;
  /** 拾った兆候の呼び名（重い順）。画面と指示文に出す。 */
  signs: string[];
}

interface Sign {
  label: string;
  level: RedFlagLevel;
  pattern: RegExp;
}

/**
 * 拾う兆候。上ほど重い。
 * 「息が上がった」「心臓がバクバク」のように、きつい練習の後なら普通に起きることは入れていない。
 */
const SIGNS: Sign[] = [
  {
    label: '胸の痛み',
    level: 'emergency',
    pattern: /胸痛|胸(?:が|の|に|を|も)?(?:痛|いた[いくかみ]|苦し|くるし|締め付け|締めつけ|しめつけ|圧迫|押さえつけ|重苦し|ぎゅっと)/,
  },
  {
    label: '意識が遠のく感じ',
    level: 'emergency',
    pattern: /失神|気を失|気絶|意識(?:が|を)?(?:遠の|失|なくな|飛|とび|とん|朦朧|もうろう)|倒れ(?:た|て|そう|込)/,
  },
  {
    label: 'ろれつが回らない・片側のしびれ',
    level: 'emergency',
    pattern: /ろれつ|呂律|顔(?:が|の)?(?:ゆが|歪)|片(?:側|方)[^。\n]{0,6}(?:しびれ|痺れ|麻痺|動かな)/,
  },
  {
    label: '息ができない',
    level: 'emergency',
    pattern: /(?:息|呼吸)(?:が)?(?:でき|吸え)(?:な|ませ)/,
  },
  {
    label: 'いつもと違う息苦しさ',
    level: 'warning',
    pattern: /息苦し|いきぐるし|呼吸(?:が)?(?:苦し|くるし|おかし|変)/,
  },
  {
    label: '動悸・脈の乱れ',
    level: 'warning',
    pattern: /動悸|不整脈|脈(?:が)?(?:乱れ|飛|とぶ|とん|おかし|バラバラ)/,
  },
  {
    label: 'めまい・ふらつき',
    level: 'warning',
    pattern: /めまい|目眩|眩暈|ふらつ|ふらふら|フラフラ|くらくら|クラクラ|目の前が(?:暗|白|真っ|チカチカ)/,
  },
  {
    label: '冷や汗',
    level: 'warning',
    pattern: /冷や汗|冷汗/,
  },
];

/**
 * 兆候のすぐ後ろが打ち消しなら、拾わない。「胸の痛みはない」「めまいもありません」。
 * **打ち消しは、兆候にくっついている時だけ見る。** 「動悸がして眠れない」の「ない」は
 * 眠れないの打ち消しで、動悸は本当にある。離れた「ない」まで拾うと、本物を見逃す。
 */
const NEGATED =
  /^(?:み|く|さ)?(?:[はがもを])?(?:全く|まったく|特に|とくに|もう|一切)?(?:し|起き|出|感じ|なら)?(?:ない|無い|なかった|無かった|ません|ませんでした|ありません|ありませんでした|なし|無し|ゼロ|大丈夫|平気)/;

/** 文章から兆候を拾う。無ければ null。 */
export function detectRedFlags(text: string): RedFlag | null {
  if (!text) return null;
  const found: Sign[] = [];

  for (const sign of SIGNS) {
    const global = new RegExp(sign.pattern.source, 'g');
    for (const match of text.matchAll(global)) {
      const after = text.slice((match.index ?? 0) + match[0].length);
      if (NEGATED.test(after)) continue;
      found.push(sign);
      break;
    }
  }

  if (found.length === 0) return null;
  return {
    level: found.some((sign) => sign.level === 'emergency') ? 'emergency' : 'warning',
    signs: found.map((sign) => sign.label),
  };
}

/**
 * **モデルが書かなかった時に、コードで必ず出す文言。**
 * 重い兆候では、モデルが何を書いても先頭に置く。受診の判断をこちらが代わりにすることはできないが、
 * 「やめる」「119」だけは、どんな時も確実に届ける。
 */
export function redFlagNotice(flag: RedFlag): string {
  const signs = flag.signs.join('・');
  return flag.level === 'emergency'
    ? `**すぐに運動をやめてください。** ${signs}は、心臓や脳の危険な兆候のことがあります。` +
        '**症状が今も続いている・強い時は、ためらわずに 119 番に電話してください。**' +
        'おさまっていても、走るのは医師に診てもらってからにしてください。'
    : `**今日の運動はやめて、休んでください。** ${signs}が続く・繰り返す・強くなる時は、` +
        '医療機関（循環器内科など）を受診してください。強い時は 119 番へ。';
}

/**
 * 飾りの無い版。エラーの帯（太字を解釈しない）に出す時に使う。
 * **モデルが落ちていても、上限に当たっていても、この文だけは届ける。**
 */
export function redFlagNoticePlain(flag: RedFlag): string {
  return redFlagNotice(flag).replace(/\*\*/g, '');
}

/** 返答に、欠かせない行動が書かれているか。 */
export function coversRedFlag(text: string, flag: RedFlag): boolean {
  if (flag.level === 'emergency') return /119/.test(text);
  return /(受診|医療機関|病院|医師|循環器|119)/.test(text);
}

/**
 * 返答を、安全の文言が必ず入った形にする。
 * 重い兆候では、決まった文言を**必ず先頭に**置く（モデルが書いていても、二度書く価値がある）。
 * 軽い兆候では、受診の話が抜けていた時だけ足す。
 */
export function guardRedFlagReply(text: string, flag: RedFlag): string {
  const notice = redFlagNotice(flag);
  if (!text.trim()) return notice;
  // **二度足さない。** ループの中と、ループを抜けた後の両方から通るため。
  if (text.startsWith(notice)) return text;
  if (flag.level === 'emergency' || !coversRedFlag(text, flag)) return `${notice}\n\n${text}`;
  return text;
}

/** 記録として残す期間。重い兆候は2週間、軽い兆候は3日。この間に解除されなければ、練習を出さない。 */
const WINDOW_DAYS: Record<RedFlagLevel, number> = { emergency: 14, warning: 3 };

/** 残しておく件数。 */
const MAX_RECORDS = 10;

/** 同じ訴えを二重に残さない間隔。返答の作り直しでは、同じ文章がもう一度届く。 */
const SAME_REPORT_MS = 60 * 60 * 1000;

export function recordRedFlag(profile: RunnerProfile, flag: RedFlag, now: Date = new Date()): RunnerProfile {
  const last = profile.redFlags?.at(-1);
  if (
    last &&
    !last.clearedAt &&
    last.level === flag.level &&
    last.signs.join() === flag.signs.join() &&
    now.getTime() - Date.parse(last.at) < SAME_REPORT_MS
  ) {
    return profile;
  }
  const record: RedFlagRecord = { ...flag, at: now.toISOString() };
  return {
    ...profile,
    redFlags: [...(profile.redFlags ?? []), record].slice(-MAX_RECORDS),
    updatedAt: now.toISOString(),
  };
}

export interface ActiveRedFlag {
  record: RedFlagRecord;
  /** 訴えから何日たったか（0 は今日）。 */
  daysAgo: number;
}

/** まだ解除されていない、期間内の訴えのうち、いちばん重く新しいもの。 */
export function activeRedFlag(profile: RunnerProfile, now: Date = new Date()): ActiveRedFlag | null {
  const live = (profile.redFlags ?? [])
    .filter((record) => !record.clearedAt)
    .map((record) => ({
      record,
      daysAgo: Math.floor((now.getTime() - Date.parse(record.at)) / 86_400_000),
    }))
    .filter(({ record, daysAgo }) => daysAgo >= 0 && daysAgo < WINDOW_DAYS[record.level]);
  if (live.length === 0) return null;
  // 重いものを優先し、同じ重さなら新しいもの。
  live.sort(
    (a, b) =>
      Number(b.record.level === 'emergency') - Number(a.record.level === 'emergency') || a.daysAgo - b.daysAgo,
  );
  return live[0];
}

/** 解除する。医師に診てもらった、または症状が消えたと本人が言った時だけ（ツール clear_red_flag）。 */
export function clearRedFlags(profile: RunnerProfile, reason: string, now: Date = new Date()): RunnerProfile {
  return {
    ...profile,
    redFlags: (profile.redFlags ?? []).map((record) =>
      record.clearedAt ? record : { ...record, clearedAt: now.toISOString(), clearedReason: reason },
    ),
    updatedAt: now.toISOString(),
  };
}

/**
 * 走行メニューが混ざった返答を書き直させる時の指示。
 * 痛みの時の書き直し（フォームの仮説・代替トレーニング）は、胸の痛みやめまいには当てはまらない。
 */
export function redFlagRetryDirective(record: RedFlag): string {
  return (
    '【書き直し指示】直前の回答には走行メニューが含まれていた。' +
    `このランナーは「${record.signs.join('・')}」を訴えており、医師に診てもらうまで、走ることもきつい運動も許されない。` +
    '走る・ジョグ・ペース走・インターバルを一切含めず、運動をやめること、' +
    (record.level === 'emergency' ? '症状が続く・強い時は 119 番、' : '続く・繰り返す時は受診、') +
    'そして今の様子を聞く言葉だけで、同じ温かさで書き直すこと。'
  );
}

/**
 * 指示文に差し込む強制の指示。
 * 当日（いま訴えた・今日訴えた）と、後日（その後の確認）で、言うべきことが違う。
 */
export function redFlagDirectives(active: ActiveRedFlag): string[] {
  const { record, daysAgo } = active;
  const signs = record.signs.join('・');
  const emergency = record.level === 'emergency';

  if (daysAgo === 0) {
    return [
      `【最優先・安全（例外なし）】ランナーが「${signs}」を訴えている。心臓・脳・呼吸の危険な兆候の可能性がある。`,
      '返答の最初の一文で、運動をすぐにやめるよう伝えること。',
      emergency
        ? '症状が今も続いている・強い時は、ためらわずに 119 番へ電話するよう、はっきり書くこと。今まさに症状があるなら、返答は短くし、まず 119 番。'
        : '今日の運動は中止して休むよう伝えること。続く・繰り返す・強くなる時は、医療機関（循環器内科など）の受診を具体的に勧めること。',
      '医師に診てもらうまで、走る練習もきつい運動も一切提案しないこと。',
      '原因を決めつけないこと。「疲れのせい」「大丈夫」「よくあること」とは言わない（診断はできない）。',
      '口調はキャラクターのままでよいが、この部分は短く、はっきり書くこと。',
    ];
  }

  return [
    `【安全】${daysAgo}日前に「${signs}」の訴えがあった。まだ解除されていない。`,
    'まず、その後の様子と、医師に診てもらったかを確認すること。',
    emergency
      ? '医師に診てもらって問題ないと言われたと本人が言うまで、走る練習もきつい運動も提案しないこと。そう言われたら clear_red_flag を呼ぶ。'
      : '症状がすっかり消えたと本人が言うまで、走る練習もきつい運動も提案しないこと。消えていれば clear_red_flag を呼ぶ。',
  ];
}
