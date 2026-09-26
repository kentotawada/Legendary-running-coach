import type { Content } from '@google/genai';

/**
 * コーチングのフェーズ。ユーザーの「現在地」であって、優劣ではない。
 * 対話の中でいつでも行き来する前提で設計している。
 */
export type CoachingPhase =
  /** まだ何も分かっていない。まずは聞くところから。 */
  | 'unknown'
  /** 目標はない / 習慣にしたいだけ。数字とノルマを一切出さない。 */
  | 'habit'
  /** 明確な目標がある。ゴールから逆算したロードマップを描く。 */
  | 'goal'
  /** 痛み・故障からの回復期。走らせない。 */
  | 'recovery';

export interface PhaseChange {
  from: CoachingPhase;
  to: CoachingPhase;
  /** なぜ変わったと判断したか。ユーザーの言葉をそのまま残す。 */
  reason: string;
  at: string;
}

export type GoalKind = 'race' | 'time' | 'health' | 'habit' | 'none';

/** A=最重要、B=調整、C=練習の一環。ピーキングをどこに合わせるかの判断に使う。 */
export type RacePriority = 'A' | 'B' | 'C';

/**
 * 出場予定の大会。複数エントリーする人が珍しくないので、リストで持つ。
 * 「本番」は1つとは限らず、どれに合わせて仕上げるかがコーチングの分岐点になる。
 */
export interface RaceEntry {
  id: string;
  /** 大会名。例: 「東京マラソン」 */
  name: string;
  /** YYYY-MM-DD */
  date: string;
  /** 「フル」「ハーフ」「30km」「ウルトラ」など。 */
  distance?: string;
  /** その大会での目標タイム。全体の目標と違っていてよい。 */
  targetTime?: string;
  priority: RacePriority;
  /** 「気温が高い」「高低差がある」など、当日を左右する条件。 */
  note?: string;
}

export interface RunnerGoal {
  kind: GoalKind;
  /** 「サブスリー達成」「初フルマラソン完走」など。 */
  summary: string;
  /** @deprecated races へ移行済み。古い保存データを読むためだけに残している。 */
  raceName?: string;
  /** @deprecated races へ移行済み。YYYY-MM-DD */
  raceDate?: string;
  /** "2:59:59" のような目標タイム。 */
  targetTime?: string;
  /** 目標ペース。未設定なら目標タイムから計算する。手動設定があればそちらを優先。 */
  targetPace?: string;
  /** 動機。ここが変わった時が、指導スタイルを変えるタイミング。 */
  why?: string;
}

export type PainStatus = 'active' | 'improving' | 'resolved';

export interface PainPoint {
  id: string;
  /** 「右膝の外側」「左アキレス腱」など。 */
  site: string;
  /** 0-5。1以上は走行メニューを出さない。 */
  severity: number;
  status: PainStatus;
  /** いつから、どんな時に痛むか。 */
  description?: string;
  since?: string;
  updatedAt: string;
}

export interface ConditionLog {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** 0-5。5が最も疲れている。 */
  fatigue?: number;
  sleepHours?: number;
  /** 「気持ちが乗らない」「やる気十分」など、本人の言葉。 */
  mood?: string;
  /** その日に使える時間（分）。0 なら完全休養日。 */
  availableMinutes?: number;
  note?: string;
  createdAt: string;
}

export type ActivityType = 'run' | 'walk' | 'cross' | 'strength' | 'stretch' | 'rest';
/**
 * 記録がどこから来たか。
 * 読み取り誤りを疑えるようにしておくためと、コーチに「もう手元にある」と伝えるため。
 */
export type ActivitySource = 'self-report' | 'screenshot' | 'strava' | 'health' | 'file';

/** 時計やアプリの計測データ。スクリーンショットから読み取った値もここに入る。 */
export interface WorkoutMetrics {
  /** "4:15/km" のような平均ペース。 */
  avgPace?: string;
  avgHr?: number;
  maxHr?: number;
  /** ピッチ（spm）。 */
  cadence?: number;
  /** ストライド（m）。 */
  strideM?: number;
  elevationGainM?: number;
  /**
   * フォームの指標。**FIT ファイルからしか入ってきません。**
   * スクリーンショットにも GPX / TCX にも無い、走りの質そのものに触れる数値です。
   */
  /** ランニングパワー(W)。 */
  powerW?: number;
  /** 上下動(cm)。小さいほど、前に進む力に変わっている。 */
  verticalOscillationCm?: number;
  /** 接地時間(ms)。短いほど、地面を押す時間が短い。 */
  groundContactMs?: number;
  /** 接地時間の左右バランス（左の割合 %）。50 が均等。 */
  balanceLeft?: number;
  /** 上下動比(%)。上下動 ÷ 歩幅。 */
  verticalRatio?: number;
  /** 歩幅(cm)。 */
  stepLengthCm?: number;
  /** 消費カロリーや気温など、上の枠に入らない補足。 */
  note?: string;
}

/**
 * ラップ（区間）1本ぶん。
 *
 * **平均だけでは、練習の中身が分からない。**
 * 「1km×5本」を平均ペースで見ると、1本目から突っ込んで最後が垂れた走りも、
 * 全部同じペースで刻んだ走りも、同じ数字になる。指導が変わるのはそこなのに。
 */
export interface ActivityLap {
  /** 何本目か。1始まり。 */
  index: number;
  distanceKm: number;
  durationSec: number;
  /** "4:15/km" */
  pace?: string;
  avgHr?: number;
  maxHr?: number;
  /** ピッチ(spm)。 */
  cadence?: number;
  /** ここから下は FIT ファイルからのみ。 */
  powerW?: number;
  verticalOscillationCm?: number;
  groundContactMs?: number;
}

/**
 * 走っている間の推移。ラップより細かい動きを見るため。
 *
 * 列ごとの配列で持つ。1点ごとにオブジェクトを作ると、同じ情報が何倍にも膨らむ。
 * 点は間引いてある（生の1秒ごとは持たない）。
 */
export interface ActivitySeries {
  /** 開始からの経過秒。 */
  t: number[];
  /** 開始からの距離(km)。 */
  km: number[];
  /** 心拍。測れていない点は null。 */
  hr: (number | null)[];
  /** ペース(秒/km)。 */
  pace?: (number | null)[];
  /** ピッチ(spm)。 */
  cadence?: (number | null)[];
  /** ランニングパワー(W)。FIT からのみ。 */
  power?: (number | null)[];
  /** 上下動(cm)。FIT からのみ。 */
  vo?: (number | null)[];
  /** 接地時間(ms)。FIT からのみ。 */
  gct?: (number | null)[];
  /** 歩幅(cm)。FIT からのみ。 */
  step?: (number | null)[];
}

export interface ActivityLog {
  id: string;
  date: string;
  type: ActivityType;
  /** ポイント練習の種別。例: "閾値走", "インターバル", "ロング走", "レース" */
  session?: string;
  distanceKm?: number;
  durationMin?: number;
  /** 主観的運動強度 1-10。 */
  effort?: number;
  /** 走った後の感覚。数値に出ない情報として重視する。 */
  felt?: string;
  metrics?: WorkoutMetrics;
  /** 画像から読み取った値かどうか。読み取り誤りを疑えるようにしておく。 */
  source?: ActivitySource;
  /** どのシューズで走ったか。走行距離を積む先。 */
  shoeId?: string;
  /** 外部サービスから取り込んだ記録の元ID。例: "strava:12345"。二重取り込みを防ぐ。 */
  externalId?: string;
  /**
   * 区間ごとの記録。時計のラップ、または1kmごとの自動区切り。
   * **ここが、スクリーンショットでは絶対に手に入らない部分。**
   */
  laps?: ActivityLap[];
  /** 走行中の推移。直近の練習にだけ残す（古い分は落とす）。 */
  series?: ActivitySeries;
  createdAt: string;
}

/** シューズの用途。寿命の目安が大きく違うので分けて持つ。 */
export type ShoeRole = 'daily' | 'race';

/**
 * 登録しているシューズ。
 *
 * ミッドソールは見た目では分からないまま潰れる。
 * 「まだ履けそう」で走り続けて故障するのは、いちばんもったいない壊れ方なので、
 * 走った距離を積んで、寿命が近づいたらこちらから知らせる。
 */
export interface ShoeEntry {
  id: string;
  /** 「ゲルカヤノ31」など、本人の呼び方のままでよい。 */
  name: string;
  role: ShoeRole;
  /** これまでに走った距離(km)。登録時にすでに履いていた分を含む。 */
  km: number;
  /** 使い始めた日 YYYY-MM-DD。分からなければ空。 */
  since?: string;
  /** 引退した日。入っていれば、もう距離を積まない。 */
  retiredAt?: string;
  /**
   * 外部サービス側のID。例: "strava:g123"。
   * これが入っている靴の走行距離は**向こうが正**なので、こちらでは足し込まない。
   */
  externalId?: string;
  note?: string;
  updatedAt: string;
}

/**
 * 合った・合わなかった道具の記録。
 * 「あのジェルは胃に来た」を覚えていれば、次に勧める候補から外せる。
 */
export interface GearNote {
  id: string;
  /** 道具のカテゴリ id。分からなければ空でよい。 */
  category?: string;
  /** 商品名・銘柄。本人の言い方のまま残す。 */
  name: string;
  verdict: 'good' | 'bad';
  /** 「胃に来た」「幅が狭い」など、その人の言葉。 */
  reason?: string;
  at: string;
}

/**
 * 外部サービスとの接続。
 *
 * ランニングアプリ側に記録があるのに、こちらで打ち直させるのは無駄です。
 * つないでおけば、走り終えた時点でもう記録が入っている状態にできます。
 */
export interface StravaConnection {
  athleteId?: number;
  athleteName?: string;
  connectedAt: string;
  lastSyncedAt?: string;
  /** これまでに取り込んだ件数。画面に出す。 */
  imported?: number;
  /**
   * 取り込んだ記録の出どころ（connections.ts の SourceId）。
   * 「Garmin の設定はもう済んでいる」を画面が知るために持つ。
   * 推定なので、**無いことを「つながっていない」の根拠にしてはならない。**
   */
  sources?: string[];
  /**
   * トークン。**ここだけは絶対にブラウザへ返さない。**
   * publicProfile() がこの項目を落とす。
   */
  secret?: {
    accessToken: string;
    refreshToken: string;
    /** 有効期限（UNIX秒）。 */
    expiresAt: number;
  };
}

export interface Connections {
  strava?: StravaConnection;
}

/**
 * プッシュ通知の宛先。
 *
 * 端末ごとに1つ。これを持っている相手は、その端末へ通知を送れてしまうので、
 * **ブラウザへ返さない**（publicProfile() が落とす）。
 */
export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: string;
  /** 送れなかった回数。続くようなら、その宛先はもう生きていない。 */
  failures?: number;
}

/** 通知を出しすぎないための記録。 */
export interface NotificationState {
  lastSentAt?: string;
  lastTag?: string;
  /** 種類ごとの最終送信日（YYYY-MM-DD）。同じ知らせを続けて出さないため。 */
  sentOn?: Record<string, string>;
}

export type PlanIntensity = 'rest' | 'easy' | 'moderate' | 'hard';

export interface CoachPlan {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  title: string;
  steps: string[];
  /** なぜこのメニューなのか。根拠を必ず言葉にする。 */
  rationale: string;
  intensity: PlanIntensity;
  estimatedMinutes?: number;
  /** 「時間が取れなかったら」「疲れが残っていたら」の逃げ道を最初から用意する。 */
  alternatives?: { when: string; what: string }[];
  createdAt: string;
}

/** 1日ぶんの記録。スタンプの土台。 */
export interface DailyRecord {
  /** YYYY-MM-DD */
  date: string;
  /** その日アプリを開いたか。 */
  opened: boolean;
  /** その日はかった体重(kg)。 */
  weightKg?: number;
}

export interface RunnerProfile {
  id: string;
  displayName?: string;
  /** 選んでいるコーチのキャラクター。話し方だけが変わる。 */
  characterId?: string;
  phase: CoachingPhase;
  phaseHistory: PhaseChange[];
  goal?: RunnerGoal;
  /** 出場予定の大会。日付順とは限らないので、読む側で並べ替える。 */
  races?: RaceEntry[];
  /** 「ランニング歴3年」「学生時代に陸上経験あり」など。 */
  experience?: string;
  weeklyVolumeKm?: number;
  bodyWeightKg?: number;
  /** 最大心拍数。心拍ゾーンの評価に必須。分からなければコーチが尋ねる。 */
  maxHr?: number;
  /** 安静時心拍数。疲労の蓄積を測る手がかり。 */
  restingHr?: number;
  /** 乳酸性作業閾値心拍（LTHR）。閾値走の強度設定に使う。 */
  lthr?: number;
  /** 過去の故障歴。再発しやすい箇所として、練習を組む時に必ず考慮する。 */
  injuryHistory?: string[];
  /** 種目 -> タイム。例: { "5km": "24:30", "full": "3:25:00" } */
  personalBests?: Record<string, string>;
  /** 走れる曜日。例: ["tue", "thu", "sun"] */
  availableDays?: string[];
  typicalSessionMinutes?: number;
  /** 「平日は朝しか時間がない」「膝に不安がある」などの制約。 */
  constraints?: string[];
  /** 走る理由・原動力。目的の変化を捉えるための記録。 */
  motivations?: string[];
  pains: PainPoint[];
  conditionLogs: ConditionLog[];
  activities: ActivityLog[];
  plans: CoachPlan[];
  /** 毎日の記録。スタンプと連続日数の土台。 */
  dailyLog?: DailyRecord[];
  /** 持っているシューズ。走った距離を積み、寿命が近づいたら知らせる。 */
  shoes?: ShoeEntry[];
  /** 合った・合わなかった道具。次に勧める時の判断材料。 */
  gearNotes?: GearNote[];
  /**
   * 外部サービスとの接続。
   * **secret を含むので、このままブラウザへ返してはならない。**
   * 画面へ渡す時は必ず publicProfile() を通すこと（profile.ts）。
   */
  connections?: Connections;
  /** 通知の宛先。**ブラウザへ返してはならない。** */
  pushSubscriptions?: PushSubscriptionRecord[];
  /** 通知を出しすぎないための記録。 */
  notifications?: NotificationState;
  /**
   * 送った画像の見返し用の控え。
   * カルテの内容ではないが、保存先の列を増やさずに済ませるためここに置いている。
   * プロンプトには載せない。
   */
  attachments?: AttachmentGroup[];
  createdAt: string;
  updatedAt: string;
}

/**
 * ユーザー1人分の状態。会話履歴は Gemini の Content[] をそのまま保持する。
 * functionCall / thoughtSignature を落とさないための意図的な設計。
 */
export interface CoachState {
  profile: RunnerProfile;
  history: Content[];
}

/** チャットに添付された画像。data は base64（接頭辞なし）。 */
export interface ImageAttachment {
  mimeType: string;
  data: string;
}

/**
 * 1回の送信で添付された画像の、見返し用の控え。
 *
 * 送った画像そのものは保存しない（すぐに保存先が膨れる）。
 * かわりに小さくしたものをここに残し、後から開き直せるようにする。
 * 古いものから落とすので、いつまでも全部が残るわけではない。
 */
export interface AttachmentGroup {
  /** 会話履歴の添付マーカーと結びつける id。 */
  id: string;
  /** data URL。画面にそのまま出せる形。 */
  images: string[];
  createdAt: string;
}

/** UI に返す表示用メッセージ。 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'coach';
  text: string;
  /** 送信直後の表示用。保存はされないので、再読み込み後は消える。 */
  imagePreviews?: string[];
  /** 保存済みの履歴で、画像が添付されていたことを示す枚数。 */
  attachmentCount?: number;
}

/**
 * 新しいランナーのカルテ。
 * 目標も故障歴も、最初は空にしておく。
 * 「サブ3を目指しているはず」と決めつけて始めると、それ以外の人の現在地を見誤る。
 * 目標は対話の中で聞き出すか、カルテ画面から本人が設定する。
 */
export function createDefaultProfile(id: string, now: string = new Date().toISOString()): RunnerProfile {
  return {
    id,
    phase: 'unknown',
    phaseHistory: [],
    pains: [],
    conditionLogs: [],
    activities: [],
    plans: [],
    createdAt: now,
    updatedAt: now,
  };
}
