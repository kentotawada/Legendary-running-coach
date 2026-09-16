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

export interface ActivityLog {
  id: string;
  date: string;
  type: ActivityType;
  distanceKm?: number;
  durationMin?: number;
  /** 主観的運動強度 1-10。 */
  effort?: number;
  /** 走った後の気分。習慣化フェーズではここが最重要指標。 */
  felt?: string;
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

export interface RunnerProfile {
  id: string;
  displayName?: string;
  phase: CoachingPhase;
  phaseHistory: PhaseChange[];
  goal?: RunnerGoal;
  /** 「ランニング歴3年」「学生時代に陸上経験あり」など。 */
  experience?: string;
  weeklyVolumeKm?: number;
  bodyWeightKg?: number;
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

/** UI に返す表示用メッセージ。 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'coach';
  text: string;
}

export function createEmptyProfile(id: string, now: string = new Date().toISOString()): RunnerProfile {
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
