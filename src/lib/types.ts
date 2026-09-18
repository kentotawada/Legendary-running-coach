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

export interface RunnerGoal {
  kind: GoalKind;
  /** 「サブスリー達成」「初フルマラソン完走」など。 */
  summary: string;
  raceName?: string;
  /** YYYY-MM-DD */
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
export type ActivitySource = 'self-report' | 'screenshot';

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
  /** 消費カロリーや気温など、上の枠に入らない補足。 */
  note?: string;
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
  createdAt: string;
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
