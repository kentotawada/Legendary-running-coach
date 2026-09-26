/**
 * 「自分の時計・アプリを、どうやってつなぐのか」に一画面で答えるための層。
 *
 * 前提として、外部サービスの窓口はこちらの都合では増やせません。
 * Garmin も Nike Run Club も、個人開発者に直接の窓口を開いていません。
 * そこで **Strava を唯一の入口**にし、それぞれの道具から Strava までの道を、
 * 使っている人ごとに1本だけ出します。
 *
 * ここで守っていること:
 *
 * 1. **その人に関係のない手順を見せない。** 使っている物を選んでもらい、
 *    選ばれた1本だけを出す。全社ぶんの手順を並べた時点で、読まれなくなる。
 * 2. **終わっている手順は消す。** 取り込んだ記録の出どころが分かれば、
 *    その道具の設定はもう済んでいる。済んだ作業をもう一度見せない。
 * 3. **できないことを、できるように書かない。** 公式の窓口が無いサービスは
 *    「一手増える」と正直に書き、増やしたくない人にはスクリーンショットの道を残す。
 */

/** 選択肢の識別子。取り込んだ記録の出どころにも同じ id を使う。 */
export type SourceId =
  | 'strava'
  | 'garmin'
  | 'apple-watch'
  | 'nike'
  | 'adidas'
  | 'coros'
  | 'polar'
  | 'suunto'
  | 'fitbit'
  | 'other'
  | 'none';

/**
 * その道具から記録が届くまでの道。
 *
 * - `direct` … このアプリと Strava をつなぐだけで終わり
 * - `link`   … Strava の中で一度だけリンクする（公式の窓口がある）
 * - `bridge` … 公式の窓口が無く、橋渡しのアプリが要る
 * - `record` … 記録する側から始める（まだ何も使っていない人）
 */
export type ConnectRoute = 'direct' | 'link' | 'bridge' | 'record';

export interface ConnectStep {
  title: string;
  detail?: string;
  /** 画面が英語表示の場合の呼び名。版によって日本語訳が変わるため併記する。 */
  english?: string;
}

/**
 * 記録ファイルを書き出せるか。
 *
 * **確かめていない画面の名前は書かない。** 「設定 → ○○ を押す」と書いて実際に無いと、
 * その人はそこで詰まって諦める。押す場所ではなく「どこを探すか」を書く。
 */
export type ExportAbility = 'yes' | 'none' | 'unknown';

export interface ConnectSource {
  id: SourceId;
  /** 選択肢に出す名前。 */
  name: string;
  /** 一覧で名前の下に出す、見分けるための一言。 */
  hint?: string;
  emoji: string;
  route: ConnectRoute;
  /**
   * Strava とつないだ後に、この人がやる作業の見積もり（分）。
   * 0 は「もう何もない」。先に出すことで、押す前に諦めるのを減らす。
   */
  minutes: number;
  /** 手順。route が direct の時は空。 */
  steps: ConnectStep[];
  /** 先に知らせておくべき制約。無いなら出さない。 */
  caution?: string;
  /** 記録ファイルを書き出せるか。 */
  canExport: ExportAbility;
  /** どこを探すか。 */
  exportHint: string;
  /** 分かっている範囲の形式。 */
  exportFormats?: string;
  /**
   * 取り込んだ記録の出どころを判定する語。
   * Strava の external_id / device_name に現れる文字列を小文字で持つ。
   */
  matchers: string[];
}

/** Strava の中でサービスをリンクする手順。表示名だけ差し替えて共通化する。 */
function linkInStrava(name: string, english: string): ConnectStep[] {
  return [
    {
      title: 'スマホの Strava アプリを開く',
      detail: 'ログイン済みの状態から始めるのが、いちばん確実です',
    },
    { title: '右下の「あなた」→ 右上の歯車（設定）', english: 'You → 設定アイコン' },
    {
      title: '「アプリ、サービス、デバイスをリンク」を開く',
      detail: '表示は Strava の版で少し変わります。似た名前の項目を探してください',
      english: 'Connect an App or Device',
    },
    { title: `一覧から ${name} を選んで「接続」`, english: `${english} → Connect` },
    {
      title: `${name} のアカウントでログインし、求められた許可を与える`,
      detail: 'ここまでで終わりです。あとは走るたびに自動で流れます',
    },
  ];
}

/**
 * 選べる道具の一覧。
 *
 * 並び順は、日本のランナーの使用率と、つなぐのが簡単な順の折衷です。
 * **Strava を先頭に置かない。** 多くの人は時計やアプリの名前で自分を探すためです。
 */
export const CONNECT_SOURCES: ConnectSource[] = [
  {
    id: 'garmin',
    name: 'Garmin の時計',
    hint: 'Forerunner / fēnix',
    emoji: '⌚️',
    route: 'link',
    minutes: 3,
    steps: linkInStrava('Garmin', 'Garmin'),
    caution:
      'リンクした後の練習から流れます。リンクより前の記録は Garmin からは遡りません（Strava にすでにある分は取り込みます）。',
    canExport: 'yes',
    exportHint:
      'ブラウザ版のアクティビティ画面で、右上の歯車（⚙）→「ファイルのエクスポート」。**スマホのアプリには書き出しがありません**（実機で確認済み）。',
    exportFormats: 'FIT / TCX / GPX',
    matchers: ['garmin'],
  },
  {
    id: 'apple-watch',
    name: 'Apple Watch',
    hint: '純正ワークアウト',
    emoji: '🍎',
    route: 'bridge',
    minutes: 5,
    steps: [
      {
        title: 'Apple Watch の Strava アプリで記録しているなら、ここで終わりです',
        detail: '上の「Strava とつなぐ」だけで、記録はそのまま入ってきます',
      },
      {
        title: '純正の「ワークアウト」で記録している場合は、もう一手要ります',
        detail: '純正の記録は iPhone の「ヘルスケア」には入りますが、Strava へは自動で流れません',
      },
      {
        title: 'HealthFit か RunGap を入れ、ヘルスケアの読み取りを許可する',
        detail: 'どちらも App Store にある橋渡しアプリです（有料の機能があります）',
      },
      {
        title: 'そのアプリの設定で、Strava への自動アップロードを有効にする',
      },
    ],
    caution:
      'Strava は iPhone の「ヘルスケア」へ書き込みはしますが、読み取りはしません。純正ワークアウトだけが、この一手を必要とします。',
    canExport: 'none',
    exportHint:
      '純正の「ワークアウト」には書き出しがありません。橋渡しアプリ（HealthFit など）なら書き出せます。使っていなければ、スクリーンショットで十分です。',
    matchers: ['apple', 'healthfit', 'rungap'],
  },
  {
    id: 'nike',
    name: 'Nike Run Club',
    hint: 'NRC',
    emoji: '👟',
    route: 'bridge',
    minutes: 5,
    steps: [
      {
        title: 'Nike Run Club の記録は、iPhone の「ヘルスケア」に入ります',
        detail: 'NRC の設定で、ヘルスケアへの書き込みが有効になっていることを確認してください',
      },
      {
        title: 'HealthFit か RunGap を入れ、ヘルスケアの読み取りを許可する',
        detail: 'どちらも App Store にある橋渡しアプリです（有料の機能があります）',
      },
      {
        title: 'そのアプリの設定で、Strava への自動アップロードを有効にする',
        detail: '以降は、NRC で走り終えるたびに Strava へ流れます',
      },
    ],
    caution:
      'Nike Run Club は外部サービス向けの公式な窓口を出していないため、ここだけ一手増えます。Android では使える橋渡しアプリが限られます。',
    canExport: 'none',
    exportHint:
      'Nike Run Club には記録ファイルの書き出しがありません。**スクリーンショットがいちばん確実です。**橋渡しアプリ（HealthFit / RunGap）を使えば書き出せます。',
    matchers: ['nike'],
  },
  {
    id: 'coros',
    name: 'COROS',
    hint: 'PACE / APEX',
    emoji: '⌚️',
    route: 'link',
    minutes: 3,
    steps: linkInStrava('COROS', 'COROS'),
    canExport: 'yes',
    exportHint:
      'アプリかウェブ版の、その練習の画面で「エクスポート」「書き出し」を探してください。FIT があれば FIT を選びます。',
    exportFormats: 'FIT / TCX / GPX',
    matchers: ['coros'],
  },
  {
    id: 'polar',
    name: 'Polar',
    hint: 'Vantage / Pacer',
    emoji: '⌚️',
    route: 'link',
    minutes: 3,
    steps: linkInStrava('Polar', 'Polar Flow'),
    canExport: 'yes',
    exportHint:
      'Polar Flow（ウェブ版）の練習の画面で「エクスポート」を探してください。',
    exportFormats: 'TCX / GPX',
    matchers: ['polar'],
  },
  {
    id: 'suunto',
    name: 'Suunto',
    emoji: '⌚️',
    route: 'link',
    minutes: 3,
    steps: linkInStrava('Suunto', 'Suunto'),
    canExport: 'yes',
    exportHint: 'アプリかウェブ版の練習の画面で「エクスポート」を探してください。',
    exportFormats: 'FIT / GPX',
    matchers: ['suunto'],
  },
  {
    id: 'fitbit',
    name: 'Fitbit',
    emoji: '⌚️',
    route: 'link',
    minutes: 3,
    steps: linkInStrava('Fitbit', 'Fitbit'),
    canExport: 'yes',
    exportHint: 'ウェブ版の運動の記録から書き出せます。アプリ側には無いことがあります。',
    exportFormats: 'TCX',
    matchers: ['fitbit'],
  },
  {
    id: 'adidas',
    name: 'adidas Running',
    hint: '旧 Runtastic',
    emoji: '📱',
    route: 'link',
    minutes: 3,
    steps: linkInStrava('adidas Running', 'adidas Running'),
    canExport: 'yes',
    exportHint: 'ウェブ版の練習の画面で「エクスポート」を探してください。',
    exportFormats: 'GPX / TCX',
    matchers: ['adidas', 'runtastic'],
  },
  {
    id: 'strava',
    name: 'Strava で記録',
    hint: '走る時にスタートを押す',
    emoji: '🟧',
    route: 'direct',
    minutes: 0,
    steps: [],
    canExport: 'yes',
    exportHint:
      'ウェブ版の活動ページで「…」→ 書き出し。「元のファイル」を選ぶと、時計が記録したそのままが取れます。',
    exportFormats: '元のファイル（FIT）/ TCX / GPX',
    matchers: ['strava'],
  },
  {
    id: 'other',
    name: 'その他',
    hint: 'Wahoo / TATTA など',
    emoji: '🔎',
    route: 'link',
    minutes: 3,
    steps: [
      { title: 'スマホの Strava アプリを開く' },
      { title: '右下の「あなた」→ 右上の歯車（設定）', english: 'You → 設定アイコン' },
      {
        title: '「アプリ、サービス、デバイスをリンク」を開き、使っているサービスを探す',
        english: 'Connect an App or Device',
      },
      {
        title: '名前があれば「接続」。無ければ、そのサービス側の設定に Strava があるか見る',
        detail: '窓口はどちらか片側にあります。両方に無ければ、自動では流れません',
      },
    ],
    caution:
      'どちらにも窓口が無いサービスもあります。その時は、これまでどおりスクリーンショットを送ってください。',
    canExport: 'unknown',
    exportHint:
      'その練習の画面で「エクスポート」「書き出し」「Export」を探してください。無ければ、スクリーンショットで送れば同じように読み取ります。',
    matchers: [],
  },
  {
    id: 'none',
    name: '何も使っていない',
    hint: 'スマホだけ',
    emoji: '🙌',
    route: 'record',
    minutes: 2,
    steps: [
      {
        title: 'スマホに Strava を入れて、アカウントを作る（無料で使えます）',
      },
      {
        title: '走り始めに「記録」を押して、終わりに止める',
        detail: 'スマホをポケットに入れておくだけで、距離とペースが残ります',
      },
      {
        title: '上の「Strava とつなぐ」を押せば、その記録がこちらへ入ります',
      },
    ],
    canExport: 'none',
    exportHint: 'まだ記録そのものがありません。Strava などで記録を始めると、書き出せるようになります。',
    matchers: [],
  },
];

/**
 * Garmin Connect のウェブ版。
 *
 * **深い URL を案内しない。** 認証が要るページを直に指すと、
 * ログインしていない人にはログイン画面しか出ず、「押したのに進めない」になる。
 * 入口だけを指して、そこから先は手順が持つ。
 */
export const GARMIN_URL = 'https://connect.garmin.com/';

/**
 * 記録ファイルを書き出す手順。
 *
 * **スマホの Garmin Connect アプリでは書き出せません。**
 * 活動画面の「⋮」にあるのは編集・ギア・お気に入り・削除だけで、
 * 「共有」もリンクを送る機能です（実機で確認済み）。
 * 遠回りに見えても、ブラウザ版が唯一の道です。
 */
export const GARMIN_EXPORT_STEPS: ConnectStep[] = [
  {
    title: 'Garmin Connect（ブラウザ版）を開く',
    detail: '一度ログインしておけば、次からはそのまま開きます',
  },
  { title: 'メニューの「アクティビティ」から、その練習を開く' },
  {
    title: '右上の歯車（⚙）を押す',
    detail: 'ハートや鉛筆が並んでいる行の、いちばん右です',
  },
  {
    title: '「ファイルのエクスポート」を選ぶ（= FIT）',
    detail: 'zip で降りてきますが、そのままこのアプリに渡せます',
    english: 'Export Original',
  },
];

export function findSource(id: string | undefined): ConnectSource | undefined {
  return CONNECT_SOURCES.find((source) => source.id === id);
}

/**
 * 取り込んだ記録の出どころを推定する。
 *
 * **確実な判定ではない。** Strava の一覧には出どころが入らないことがあるので、
 * 「見つからない＝つながっていない」とは言い切らないこと。
 * 見つかった時にだけ「もう届いています」と言うために使う。
 *
 * 橋渡しアプリ（HealthFit / RunGap）を通った記録は Apple ヘルスケア経由とみなす。
 * iPhone では、それが実際に通っている道だから。
 */
export function detectSource(hint: string | undefined): SourceId | undefined {
  if (!hint) return undefined;
  const text = hint.toLowerCase();
  for (const source of CONNECT_SOURCES) {
    if (source.matchers.some((matcher) => text.includes(matcher))) return source.id;
  }
  return undefined;
}

/** 出どころの一覧を、重複なく足す。 */
export function mergeSources(known: SourceId[] | undefined, found: SourceId[]): SourceId[] {
  return [...new Set([...(known ?? []), ...found])];
}

/** この道具は、Strava とつないだ後に作業が残るか。 */
export function needsSetup(source: ConnectSource, detected: SourceId[] = []): boolean {
  if (source.route === 'direct') return false;
  return !detected.includes(source.id);
}

/**
 * 書き出す形式の選び方。**どのサービスでも同じ。**
 * 迷った時にこれだけ覚えていれば足りる。
 */
export const FORMAT_ORDER = 'FIT → TCX → GPX の順に、入る情報が多くなります。迷ったら上から選んでください。';

/** 画面に出す、残り作業の見積もり。 */
export function effortLabel(source: ConnectSource, detected: SourceId[] = []): string {
  // まだつないでいない人に「もう届いています」と言わない。
  // この道具はもともと作業が無い、という意味の文にする。
  if (source.route === 'direct') return '追加の設定なし';
  if (!needsSetup(source, detected)) return 'もう届いています';
  return `Strava の中で一度だけ・約${source.minutes}分`;
}
