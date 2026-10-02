/**
 * 暑さ・寒さを、走る前に言う。
 *
 * **時計は、走り終えてから「暑さの影響がありました」と言う。**
 * それは記録の説明にはなるが、走る前の判断には1秒も役に立たない。
 * 走る人が知りたいのは、玄関を出る前に「今日はどのくらい落とすか」。
 *
 * 夏は、同じ心拍でも同じ速度が出ない。それを知らずに目標ペースで入ると、
 * 後半で潰れて、本人は「力が落ちた」と思う。**落ちていない。暑いだけ。**
 *
 * ## 何で測るか
 *
 * 気温だけでは足りない。**体温を下げられるかどうかは、湿度で決まる。**
 * 30度・湿度30%（乾燥）と、28度・湿度85%（蒸し暑い）では、後者のほうがきつい。
 * そこで**露点**（空気が水を手放す温度）を使う。汗の蒸発しやすさに直結する指標で、
 * 走る世界でいちばん広く使われている。
 *
 * ## やらないこと
 *
 * - **走るなとは言わない。** 言うのは「どれだけ落とすか」だけ。
 *   例外は、落としても危ない領域（露点24度超え）で、そこは時間帯をずらす話にする。
 * - **細かい数字を装わない。** 出すのは「10〜15秒」のような幅。
 *   1秒単位で出すと、当たっているように見えてしまう。
 */

/** 外から取ってくる、その場の空気。 */
export interface Weather {
  temperatureC: number;
  /** 相対湿度(%)。 */
  humidity: number;
  /** 取得した時刻（ISO）。古くなったら取り直す。 */
  at: string;
}

/** これより古い読みは使わない（時間）。 */
export const WEATHER_STALE_HOURS = 3;

export function isFresh(weather: Weather | undefined, now: Date = new Date()): boolean {
  if (!weather) return false;
  const at = Date.parse(weather.at);
  if (Number.isNaN(at)) return false;
  const hours = (now.getTime() - at) / 3_600_000;
  return hours >= 0 && hours < WEATHER_STALE_HOURS;
}

/**
 * 露点（℃）。Magnus の式。
 *
 * **ここは近似でよい。** 0.1度の精度は、走る判断を何も変えない。
 */
export function dewPointC(temperatureC: number, humidity: number): number {
  const rh = Math.min(100, Math.max(1, humidity));
  const a = 17.27;
  const b = 237.7;
  const gamma = (a * temperatureC) / (b + temperatureC) + Math.log(rh / 100);
  return Math.round(((b * gamma) / (a - gamma)) * 10) / 10;
}

export type HeatLevel =
  /** 影響なし。 */
  | 'none'
  /** 少し落とす。 */
  | 'mild'
  /** はっきり落とす。 */
  | 'strong'
  /** 落としても危ない。時間帯をずらす話にする。 */
  | 'severe'
  /** 寒い側。ペースではなく、準備の話。 */
  | 'cold';

export interface HeatAdvice {
  level: HeatLevel;
  dewPointC: number;
  /** 落とす目安（%）。幅の中央。 */
  slowPercent: number;
  /** 1kmあたり何秒落とすか。走る人のペースが分かる時だけ。 */
  slowSecFrom?: number;
  slowSecTo?: number;
  headline: string;
  detail: string;
}

/**
 * 露点から、どれだけ落とすか。
 *
 * 目安は走る世界で広く使われているもの。**断定しない幅で出す。**
 * 暑さへの強さは人によって違うし、慣れている人ほど影響が小さい。
 */
const BANDS: { upTo: number; percent: number; level: HeatLevel }[] = [
  { upTo: 12, percent: 0, level: 'none' },
  { upTo: 16, percent: 1, level: 'mild' },
  { upTo: 18, percent: 2, level: 'mild' },
  { upTo: 21, percent: 3.5, level: 'strong' },
  { upTo: 24, percent: 5, level: 'strong' },
  { upTo: 99, percent: 7, level: 'severe' },
];

/**
 * 今日の暑さ・寒さの助言。
 *
 * @param paceSec その人のイージーのペース（秒/km）。あれば秒で言える。
 */
export function heatAdvice(weather: Weather, paceSec?: number): HeatAdvice {
  const dew = dewPointC(weather.temperatureC, weather.humidity);

  // 寒い側。ペースを落とす話ではなく、準備の話。
  if (weather.temperatureC <= 3) {
    return {
      level: 'cold',
      dewPointC: dew,
      slowPercent: 0,
      headline: `${Math.round(weather.temperatureC)}度。入りをゆっくり`,
      detail:
        '寒い日は、体が温まるまでの最初の10分が硬いままになります。いつもより遅く入って、' +
        '温まってから上げてください。路面が凍っていそうなら、ペースより足元を優先に。',
    };
  }

  const band = BANDS.find((entry) => dew <= entry.upTo) ?? BANDS[BANDS.length - 1];
  const percent = band.percent;

  const slowSecFrom = paceSec ? Math.round((paceSec * (percent - 1)) / 100) : undefined;
  const slowSecTo = paceSec ? Math.round((paceSec * (percent + 1)) / 100) : undefined;
  const range =
    slowSecFrom !== undefined && slowSecTo !== undefined && slowSecTo > 0
      ? `1kmあたり ${Math.max(0, slowSecFrom)}〜${slowSecTo}秒`
      : `${percent}%ほど`;

  const air = `${Math.round(weather.temperatureC)}度・湿度${Math.round(weather.humidity)}%`;

  if (band.level === 'none') {
    return {
      level: 'none',
      dewPointC: dew,
      slowPercent: 0,
      headline: `${air}。走りやすい日です`,
      detail: '暑さの影響はほとんどありません。いつものペースで大丈夫です。',
    };
  }

  if (band.level === 'severe') {
    return {
      level: 'severe',
      dewPointC: dew,
      slowPercent: percent,
      slowSecFrom,
      slowSecTo,
      headline: `${air}。ペースを見ない日に`,
      detail:
        `蒸し暑さ（露点${dew}度）がかなり強い日です。${range}落としても、同じきつさになります。` +
        '時計のペースは見ずに、感覚と心拍で走ってください。朝晩にずらせるなら、そのほうが速く走れます。' +
        '水分は、のどが渇く前に。落とした結果を「遅くなった」と数えないでください。暑さのぶんです。',
    };
  }

  return {
    level: band.level,
    dewPointC: dew,
    slowPercent: percent,
    slowSecFrom,
    slowSecTo,
    headline: `${air}。${range}落として`,
    detail:
      `露点${dew}度。同じ心拍でも、涼しい日と同じ速度は出ません。` +
      `${range}落とすと、体にかかる負荷がいつもと同じになります。` +
      '落とした結果を「遅くなった」と数えないでください。暑さのぶんです。',
  };
}

interface OpenMeteoCurrent {
  temperature_2m?: unknown;
  relative_humidity_2m?: unknown;
}

/**
 * いまの空気を取ってくる。
 *
 * **鍵の要らないところを選んである**（Open-Meteo）。
 * 設定する項目がひとつ増えるたびに、本番で入れ忘れが起きる。
 */
export async function fetchWeather(
  lat: number,
  lon: number,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
  now: Date = new Date(),
): Promise<Weather | null> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(2),
    longitude: lon.toFixed(2),
    current: 'temperature_2m,relative_humidity_2m',
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const response = await fetchImpl(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return null;

    const json = (await response.json()) as { current?: OpenMeteoCurrent };
    const current = json.current ?? {};
    const temperatureC = current.temperature_2m;
    const humidity = current.relative_humidity_2m;
    if (typeof temperatureC !== 'number' || typeof humidity !== 'number') return null;

    return { temperatureC, humidity, at: now.toISOString() };
  } catch {
    // 天気が取れなくても、今日やることは出る。**ここで止めない。**
    return null;
  }
}
