import type {
  ActivityLog,
  ChatMessage,
  CoachPlan,
  CoachingPhase,
  ConditionLog,
  PainPoint,
  RunnerGoal,
  RunnerProfile,
} from './types';
import type { Content } from '@google/genai';
import { PHASE_LABEL } from './phase';
import { INTERNAL_PREFIX, attachmentCountOf } from './markers';

/** 直近の記録だけを文脈に載せる。古い記録は要約としてのみ残す。 */
const MAX_CONDITION_LOGS = 120;
const MAX_ACTIVITIES = 200;
const MAX_PLANS = 60;
const RECENT_DAYS = 14;

export function newId(): string {
  return globalThis.crypto.randomUUID();
}

export function today(now: Date = new Date()): string {
  // ランナーの生活時間に合わせ、日付は実行環境のローカルタイムで扱う。
  const y = now.getFullYear();
  const m = `${now.getMonth() + 1}`.padStart(2, '0');
  const d = `${now.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function mergeUnique(existing: string[] | undefined, incoming: string[] | undefined): string[] | undefined {
  if (!incoming || incoming.length === 0) return existing;
  const merged = [...(existing ?? [])];
  for (const item of incoming) {
    const trimmed = item.trim();
    if (trimmed && !merged.includes(trimmed)) merged.push(trimmed);
  }
  return merged;
}

function tail<T>(items: T[], max: number): T[] {
  return items.length > max ? items.slice(items.length - max) : items;
}

export interface ProfilePatch {
  displayName?: string;
  experience?: string;
  weeklyVolumeKm?: number;
  bodyWeightKg?: number;
  maxHr?: number;
  restingHr?: number;
  lthr?: number;
  injuryHistory?: string[];
  personalBests?: Record<string, string>;
  availableDays?: string[];
  typicalSessionMinutes?: number;
  constraints?: string[];
  motivations?: string[];
  goal?: Partial<RunnerGoal>;
}

/**
 * 分かったことだけを上書きする。undefined は「まだ分からない」であって
 * 「消す」ではないので、既存の値を握りつぶさない。
 */
export function applyProfileUpdate(
  profile: RunnerProfile,
  patch: ProfilePatch,
  now: Date = new Date(),
): RunnerProfile {
  const next: RunnerProfile = {
    ...profile,
    displayName: patch.displayName?.trim() || profile.displayName,
    experience: patch.experience?.trim() || profile.experience,
    weeklyVolumeKm: patch.weeklyVolumeKm ?? profile.weeklyVolumeKm,
    bodyWeightKg: patch.bodyWeightKg ?? profile.bodyWeightKg,
    maxHr: patch.maxHr ?? profile.maxHr,
    restingHr: patch.restingHr ?? profile.restingHr,
    lthr: patch.lthr ?? profile.lthr,
    injuryHistory: mergeUnique(profile.injuryHistory, patch.injuryHistory),
    personalBests: patch.personalBests
      ? { ...(profile.personalBests ?? {}), ...patch.personalBests }
      : profile.personalBests,
    availableDays: patch.availableDays ?? profile.availableDays,
    typicalSessionMinutes: patch.typicalSessionMinutes ?? profile.typicalSessionMinutes,
    constraints: mergeUnique(profile.constraints, patch.constraints),
    motivations: mergeUnique(profile.motivations, patch.motivations),
    updatedAt: now.toISOString(),
  };

  if (patch.goal) {
    const base: RunnerGoal = profile.goal ?? { kind: 'none', summary: '' };
    next.goal = {
      ...base,
      ...Object.fromEntries(Object.entries(patch.goal).filter(([, v]) => v !== undefined && v !== '')),
    } as RunnerGoal;
  }

  return next;
}

export interface PainInput {
  site: string;
  severity: number;
  status?: PainPoint['status'];
  description?: string;
  since?: string;
}

function normalizeSite(site: string): string {
  return site.replace(/\s+/g, '').toLowerCase();
}

/** 同じ部位は上書き、違う部位は追加。痛みの履歴を無限に増やさない。 */
export function upsertPain(
  profile: RunnerProfile,
  input: PainInput,
  now: Date = new Date(),
): RunnerProfile {
  const stamp = now.toISOString();
  const key = normalizeSite(input.site);
  const severity = Math.min(5, Math.max(0, Math.round(input.severity)));
  const status: PainPoint['status'] = input.status ?? (severity === 0 ? 'resolved' : 'active');
  const index = profile.pains.findIndex((p) => normalizeSite(p.site) === key);

  const pains = [...profile.pains];
  if (index >= 0) {
    pains[index] = {
      ...pains[index],
      site: input.site,
      severity,
      status,
      description: input.description ?? pains[index].description,
      since: input.since ?? pains[index].since,
      updatedAt: stamp,
    };
  } else {
    pains.push({
      id: newId(),
      site: input.site,
      severity,
      status,
      description: input.description,
      since: input.since,
      updatedAt: stamp,
    });
  }

  return { ...profile, pains, updatedAt: stamp };
}

export function addConditionLog(
  profile: RunnerProfile,
  log: Omit<ConditionLog, 'id' | 'createdAt'>,
  now: Date = new Date(),
): RunnerProfile {
  const entry: ConditionLog = { ...log, id: newId(), createdAt: now.toISOString() };
  return {
    ...profile,
    conditionLogs: tail([...profile.conditionLogs, entry], MAX_CONDITION_LOGS),
    updatedAt: now.toISOString(),
  };
}

export function addActivity(
  profile: RunnerProfile,
  activity: Omit<ActivityLog, 'id' | 'createdAt'>,
  now: Date = new Date(),
): RunnerProfile {
  const entry: ActivityLog = { ...activity, id: newId(), createdAt: now.toISOString() };
  return {
    ...profile,
    activities: tail([...profile.activities, entry], MAX_ACTIVITIES),
    updatedAt: now.toISOString(),
  };
}

/** 同じ日のプランは1つ。組み替えたら上書きする。 */
export function setPlan(
  profile: RunnerProfile,
  plan: Omit<CoachPlan, 'id' | 'createdAt'>,
  now: Date = new Date(),
): RunnerProfile {
  const entry: CoachPlan = { ...plan, id: newId(), createdAt: now.toISOString() };
  const others = profile.plans.filter((p) => p.date !== plan.date);
  return {
    ...profile,
    plans: tail([...others, entry].sort((a, b) => a.date.localeCompare(b.date)), MAX_PLANS),
    updatedAt: now.toISOString(),
  };
}

/**
 * 本人がカルテから目標を編集した時は、既存の値と混ぜずに置き換える。
 * 「サブ3 → サブ4」に変えたのに古いレース情報が残る、といった事故を避けるため。
 */
export function setGoal(
  profile: RunnerProfile,
  goal: RunnerGoal | undefined,
  now: Date = new Date(),
): RunnerProfile {
  return { ...profile, goal, updatedAt: now.toISOString() };
}

/**
 * 故障歴も本人が編集する項目なので、追記ではなく置き換える。
 * 追記しかできないと、間違って入れた項目を消せなくなる。
 */
export function replaceInjuryHistory(
  profile: RunnerProfile,
  injuries: string[],
  now: Date = new Date(),
): RunnerProfile {
  const cleaned = injuries.map((item) => item.trim()).filter(Boolean);
  return {
    ...profile,
    injuryHistory: cleaned.length > 0 ? cleaned : undefined,
    updatedAt: now.toISOString(),
  };
}

export function setPhase(
  profile: RunnerProfile,
  phase: CoachingPhase,
  reason: string,
  now: Date = new Date(),
): RunnerProfile {
  if (profile.phase === phase) return profile;
  return {
    ...profile,
    phase,
    phaseHistory: [
      ...profile.phaseHistory,
      { from: profile.phase, to: phase, reason, at: now.toISOString() },
    ],
    updatedAt: now.toISOString(),
  };
}

function withinDays(date: string, days: number, now: Date): boolean {
  const t = Date.parse(date);
  if (Number.isNaN(t)) return false;
  return now.getTime() - t <= days * 86_400_000;
}

const ACTIVITY_LABEL: Record<ActivityLog['type'], string> = {
  run: 'ラン',
  walk: 'ウォーク',
  cross: 'クロストレーニング',
  strength: '補強',
  stretch: 'ストレッチ',
  rest: '完全休養',
};

/**
 * 「このランナーについて今わかっていること」を、
 * 毎ターン システムプロンプトに載せるカルテとして書き出す。
 */
export function summarizeProfile(profile: RunnerProfile, now: Date = new Date()): string {
  const lines: string[] = [];
  lines.push('# このランナーについて今わかっていること');
  lines.push(`- 現在地: ${PHASE_LABEL[profile.phase]}`);
  if (profile.displayName) lines.push(`- 呼び方: ${profile.displayName}さん`);
  if (profile.experience) lines.push(`- 経験: ${profile.experience}`);

  if (profile.goal && profile.goal.kind !== 'none') {
    const g = profile.goal;
    const parts = [g.summary];
    if (g.raceName) parts.push(`大会: ${g.raceName}`);
    if (g.raceDate) {
      const daysLeft = Math.ceil((Date.parse(g.raceDate) - now.getTime()) / 86_400_000);
      parts.push(
        Number.isNaN(daysLeft) ? `本番: ${g.raceDate}` : `本番: ${g.raceDate}（あと${daysLeft}日）`,
      );
    }
    if (g.targetTime) parts.push(`目標タイム: ${g.targetTime}`);
    lines.push(`- 目標: ${parts.filter(Boolean).join(' / ')}`);
    if (g.why) lines.push(`- その目標を選んだ理由: ${g.why}`);
  } else {
    lines.push('- 目標: まだ言葉にしていない（走力を聞き出し、サブ3までのギャップを示すところから始める）');
  }

  if (profile.personalBests && Object.keys(profile.personalBests).length > 0) {
    const pb = Object.entries(profile.personalBests).map(([k, v]) => `${k} ${v}`).join(' / ');
    lines.push(`- 自己ベスト: ${pb}`);
  }
  if (profile.weeklyVolumeKm !== undefined) lines.push(`- 週間走行距離: 約${profile.weeklyVolumeKm}km`);
  if (profile.bodyWeightKg !== undefined) lines.push(`- 体重: ${profile.bodyWeightKg}kg`);

  const hr = [
    profile.maxHr !== undefined ? `最大心拍 ${profile.maxHr}` : null,
    profile.lthr !== undefined ? `LTHR ${profile.lthr}` : null,
    profile.restingHr !== undefined ? `安静時 ${profile.restingHr}` : null,
  ].filter(Boolean);
  if (hr.length > 0) {
    lines.push(`- 心拍: ${hr.join(' / ')}`);
  } else {
    lines.push('- 心拍: 未取得（ゾーン評価が必要な場面では、推測せず最大心拍かLTHRを尋ねること）');
  }

  if (profile.injuryHistory?.length) {
    lines.push(`- 故障歴: ${profile.injuryHistory.join(' / ')}`);
  }
  if (profile.availableDays?.length) lines.push(`- 走れる曜日: ${profile.availableDays.join('・')}`);
  if (profile.typicalSessionMinutes !== undefined) {
    lines.push(`- 1回に使える時間: 約${profile.typicalSessionMinutes}分`);
  }
  if (profile.constraints?.length) lines.push(`- 生活上の制約: ${profile.constraints.join(' / ')}`);
  if (profile.motivations?.length) lines.push(`- 原動力・大事にしていること: ${profile.motivations.join(' / ')}`);

  const unresolvedPains = profile.pains.filter((p) => p.status !== 'resolved');
  if (unresolvedPains.length > 0) {
    lines.push('- 現在の痛み:');
    for (const p of unresolvedPains) {
      lines.push(
        `  - ${p.site}: 強さ${p.severity}/5・${p.status === 'improving' ? '回復傾向' : '継続中'}` +
          `${p.description ? `（${p.description}）` : ''}${p.since ? ` / ${p.since}から` : ''}`,
      );
    }
  } else if (profile.pains.length > 0) {
    lines.push(`- 過去の痛み（現在は解消）: ${profile.pains.map((p) => p.site).join('、')}`);
  }

  const recentActivities = profile.activities.filter((a) => withinDays(a.date, RECENT_DAYS, now));
  if (recentActivities.length > 0) {
    lines.push(`- 直近${RECENT_DAYS}日の行動:`);
    for (const a of recentActivities.slice(-8)) {
      const detail = [
        a.session ?? null,
        a.distanceKm !== undefined ? `${a.distanceKm}km` : null,
        a.durationMin !== undefined ? `${a.durationMin}分` : null,
        a.metrics?.avgPace ? `平均${a.metrics.avgPace}` : null,
        a.metrics?.avgHr !== undefined ? `平均心拍${a.metrics.avgHr}` : null,
        a.metrics?.maxHr !== undefined ? `最高${a.metrics.maxHr}` : null,
        a.metrics?.cadence !== undefined ? `ピッチ${a.metrics.cadence}spm` : null,
        a.metrics?.strideM !== undefined ? `ストライド${a.metrics.strideM}m` : null,
        a.metrics?.elevationGainM !== undefined ? `獲得標高${a.metrics.elevationGainM}m` : null,
        a.effort !== undefined ? `主観強度${a.effort}/10` : null,
        a.felt ? `「${a.felt}」` : null,
        a.source === 'screenshot' ? '(画像から読取)' : null,
      ]
        .filter(Boolean)
        .join(' ');
      lines.push(`  - ${a.date} ${ACTIVITY_LABEL[a.type]}${detail ? ` ${detail}` : ''}`);
    }
  } else {
    lines.push(`- 直近${RECENT_DAYS}日の行動: 記録なし（責めずに、そっと様子を聞く）`);
  }

  const recentConditions = profile.conditionLogs.filter((c) => withinDays(c.date, 7, now));
  if (recentConditions.length > 0) {
    lines.push('- 直近のコンディション:');
    for (const c of recentConditions.slice(-5)) {
      const detail = [
        c.fatigue !== undefined ? `疲労${c.fatigue}/5` : null,
        c.sleepHours !== undefined ? `睡眠${c.sleepHours}h` : null,
        c.availableMinutes !== undefined ? `使える時間${c.availableMinutes}分` : null,
        c.mood ? `気分「${c.mood}」` : null,
        c.note ?? null,
      ]
        .filter(Boolean)
        .join(' / ');
      lines.push(`  - ${c.date} ${detail}`);
    }
  }

  const latestPlan = profile.plans.at(-1);
  if (latestPlan) {
    lines.push(
      `- 直近に渡したメニュー（${latestPlan.date}）: ${latestPlan.title} — ${latestPlan.steps.join(' → ')}`,
    );
  }

  const lastChange = profile.phaseHistory.at(-1);
  if (lastChange) {
    lines.push(
      `- 直近のフェーズ変化: ${PHASE_LABEL[lastChange.from]} → ${PHASE_LABEL[lastChange.to]}（${lastChange.reason}）`,
    );
  }

  return lines.join('\n');
}

/** 保存している Gemini の Content[] から、画面に出す発言だけを取り出す。 */
export function toDisplayMessages(history: Content[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  history.forEach((content, index) => {
    const parts = (content.parts ?? []).filter(
      (part) => typeof part.text === 'string' && part.text.length > 0 && !part.thought,
    );

    const attachmentCount = parts.reduce(
      (total, part) => total + attachmentCountOf(part.text as string),
      0,
    );
    const text = parts
      .filter((part) => {
        const value = part.text as string;
        return !value.startsWith(INTERNAL_PREFIX) && attachmentCountOf(value) === 0;
      })
      .map((part) => part.text as string)
      .join('')
      .trim();

    if (!text && attachmentCount === 0) return;
    messages.push({
      id: `${index}`,
      role: content.role === 'user' ? 'user' : 'coach',
      text,
      ...(attachmentCount > 0 ? { attachmentCount } : {}),
    });
  });
  return messages;
}
