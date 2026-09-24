import type {
  ActivityLog,
  AttachmentGroup,
  ChatMessage,
  CoachPlan,
  CoachingPhase,
  ConditionLog,
  PainPoint,
  RaceEntry,
  RacePriority,
  Connections,
  GearNote,
  RunnerGoal,
  RunnerProfile,
  ShoeEntry,
  ShoeRole,
} from './types';
import type { Content } from '@google/genai';
import { PHASE_LABEL } from './phase';
import { INTERNAL_PREFIX, attachmentCountOf, attachmentGroupOf } from './markers';
import { describeRace, pastRaces, racesOf, sortRaces, upcomingRaces } from './races';
import { SHOE_ROLE_LABEL, activeShoes, findShoe } from './shoes';

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
  characterId?: string;
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
    characterId: patch.characterId?.trim() || profile.characterId,
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

/** 持てるシューズの数。履かなくなったものまで全部覚えていても、判断の役には立たない。 */
const MAX_SHOES = 12;

/** 合った・合わなかったの記録。多すぎると、いつの話か分からなくなる。 */
const MAX_GEAR_NOTES = 40;

export interface ShoeInput {
  name: string;
  role?: ShoeRole;
  /** 登録時点ですでに履いている距離(km)。 */
  km?: number;
  since?: string;
  note?: string;
}

/**
 * シューズを登録する。
 * 同じ名前のものが現役で残っていれば、二重に作らず上書きする。
 * （同じ銘柄の2足目を買う人は「31の2足目」のように呼び分ける）
 */
export function addShoes(profile: RunnerProfile, input: ShoeInput, now: Date = new Date()): RunnerProfile {
  const name = input.name.trim();
  if (!name) return profile;

  const existing = activeShoes(profile).find(
    (shoe) => shoe.name.trim().toLowerCase() === name.toLowerCase(),
  );
  const entry: ShoeEntry = {
    id: existing?.id ?? newId(),
    name,
    role: input.role ?? existing?.role ?? 'daily',
    km: Math.max(0, Math.round(input.km ?? existing?.km ?? 0)),
    since: input.since ?? existing?.since,
    note: input.note ?? existing?.note,
    updatedAt: now.toISOString(),
  };

  const others = (profile.shoes ?? []).filter((shoe) => shoe.id !== entry.id);
  return {
    ...profile,
    shoes: tail([...others, entry], MAX_SHOES),
    updatedAt: now.toISOString(),
  };
}

/**
 * 外部サービス（Strava）側の靴を、こちらへ写す。
 *
 * **走行距離は向こうが正**なので、足し込まずに上書きする。
 * こちらでも足していると、同じ練習を二重に数えることになる。
 */
export function upsertExternalShoe(
  profile: RunnerProfile,
  input: { externalId: string; name: string; km: number; role?: ShoeRole; retired?: boolean },
  now: Date = new Date(),
): RunnerProfile {
  const name = input.name.trim() || 'シューズ';
  const shoes = profile.shoes ?? [];
  const existing =
    shoes.find((shoe) => shoe.externalId === input.externalId) ??
    shoes.find((shoe) => !shoe.externalId && shoe.name.trim().toLowerCase() === name.toLowerCase());

  const entry: ShoeEntry = {
    id: existing?.id ?? newId(),
    name: existing?.name ?? name,
    // 用途は本人が直せる。すでに決まっているならそちらを尊重する。
    role: existing?.role ?? input.role ?? 'daily',
    km: Math.max(0, Math.round(input.km)),
    since: existing?.since,
    note: existing?.note,
    externalId: input.externalId,
    retiredAt: input.retired ? (existing?.retiredAt ?? today(now)) : existing?.retiredAt,
    updatedAt: now.toISOString(),
  };

  return {
    ...profile,
    shoes: tail([...shoes.filter((shoe) => shoe.id !== entry.id), entry], MAX_SHOES),
    updatedAt: now.toISOString(),
  };
}

/** 履くのをやめた1足。記録は消さない。何kmで替えたかは、次を選ぶ時の材料になる。 */
export function retireShoes(profile: RunnerProfile, nameOrId: string, now: Date = new Date()): RunnerProfile {
  const target = findShoe(profile, nameOrId);
  if (!target || target.retiredAt) return profile;
  return {
    ...profile,
    shoes: (profile.shoes ?? []).map((shoe) =>
      shoe.id === target.id ? { ...shoe, retiredAt: today(now), updatedAt: now.toISOString() } : shoe,
    ),
    updatedAt: now.toISOString(),
  };
}

/** 走った距離を1足に積む。 */
export function addShoeDistance(
  profile: RunnerProfile,
  shoeId: string,
  km: number,
  now: Date = new Date(),
): RunnerProfile {
  if (!(km > 0)) return profile;
  const shoes = profile.shoes ?? [];
  const target = shoes.find((shoe) => shoe.id === shoeId);
  if (!target) return profile;
  // 外部サービスが管理している靴には足さない。向こうの数字が正で、足すと二重になる。
  if (target.externalId) return profile;
  return {
    ...profile,
    shoes: shoes.map((shoe) =>
      shoe.id === shoeId
        ? { ...shoe, km: Math.round((shoe.km + km) * 10) / 10, updatedAt: now.toISOString() }
        : shoe,
    ),
    updatedAt: now.toISOString(),
  };
}

export interface GearNoteInput {
  name: string;
  verdict: 'good' | 'bad';
  category?: string;
  reason?: string;
}

/**
 * 「これは合わなかった」を残す。
 * 同じ物について言い直したら、新しい方だけを残す。前の判断が並んでいると、どちらが今なのか分からない。
 */
export function logGearNote(
  profile: RunnerProfile,
  input: GearNoteInput,
  now: Date = new Date(),
): RunnerProfile {
  const name = input.name.trim();
  if (!name) return profile;

  const entry: GearNote = {
    id: newId(),
    name,
    verdict: input.verdict,
    category: input.category,
    reason: input.reason,
    at: today(now),
  };
  const others = (profile.gearNotes ?? []).filter(
    (note) => note.name.trim().toLowerCase() !== name.toLowerCase(),
  );
  return {
    ...profile,
    gearNotes: tail([...others, entry], MAX_GEAR_NOTES),
    updatedAt: now.toISOString(),
  };
}

export interface RaceInput {
  name: string;
  date: string;
  distance?: string;
  targetTime?: string;
  priority?: RacePriority;
  note?: string;
}

/** 同じ大会かどうか。名前と日付が揃っていれば同じものとみなす。 */
function sameRace(a: { name: string; date: string }, b: { name: string; date: string }): boolean {
  return a.name.trim() === b.name.trim() && a.date.trim() === b.date.trim();
}

/**
 * 大会を1つしか持てなかった頃の記録を、正式な一覧へ移し替える。
 * 一覧を書き換える時にこれを通しておかないと、
 * 「登録済みの大会が races に無い」状態で上書きされ、本番の日付が消える。
 */
function materializeRaces(profile: RunnerProfile): RaceEntry[] {
  return racesOf(profile).map((race) =>
    race.id === 'legacy-goal-race' ? { ...race, id: newId() } : race,
  );
}

/** 旧フィールドは二重の情報源になるので、一覧を書いたら必ず外す。 */
function withRaces(profile: RunnerProfile, races: RaceEntry[], now: Date): RunnerProfile {
  const next: RunnerProfile = { ...profile, races: sortRaces(races), updatedAt: now.toISOString() };
  if (next.goal?.raceName || next.goal?.raceDate) {
    const { raceName: _name, raceDate: _date, ...rest } = next.goal;
    next.goal = rest;
  }
  return next;
}

/**
 * 大会を追加する。同じ大会（名前と日付が一致）は上書きする。
 * 複数の大会に出る人がいるので、1件で置き換えてはならない。
 */
export function addRace(profile: RunnerProfile, input: RaceInput, now: Date = new Date()): RunnerProfile {
  const entry: RaceEntry = {
    id: newId(),
    name: input.name.trim(),
    date: input.date.trim(),
    distance: input.distance?.trim() || undefined,
    targetTime: input.targetTime?.trim() || undefined,
    priority: input.priority ?? 'A',
    note: input.note?.trim() || undefined,
  };

  const existing = materializeRaces(profile);
  const index = existing.findIndex((race) => sameRace(race, entry));
  if (index >= 0) {
    const merged = [...existing];
    merged[index] = { ...entry, id: existing[index].id };
    return withRaces(profile, merged, now);
  }
  return withRaces(profile, [...existing, entry], now);
}

export function removeRace(profile: RunnerProfile, id: string, now: Date = new Date()): RunnerProfile {
  const remaining = materializeRaces(profile).filter((race) => race.id !== id);
  return withRaces(profile, remaining, now);
}

/**
 * 本人がカルテで一覧ごと編集した時。
 * 消す操作を成立させるため、追記ではなく置き換える。
 */
export function replaceRaces(
  profile: RunnerProfile,
  races: (RaceInput & { id?: string })[],
  now: Date = new Date(),
): RunnerProfile {
  const cleaned: RaceEntry[] = races
    .map((race) => ({
      id: race.id?.trim() || newId(),
      name: race.name.trim(),
      date: race.date.trim(),
      distance: race.distance?.trim() || undefined,
      targetTime: race.targetTime?.trim() || undefined,
      priority: race.priority ?? 'A',
      note: race.note?.trim() || undefined,
    }))
    .filter((race) => race.name || race.date);
  return withRaces(profile, cleaned, now);
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
    if (g.targetTime) parts.push(`目標タイム: ${g.targetTime}`);
    lines.push(`- 目標: ${parts.filter(Boolean).join(' / ')}`);
    if (g.why) lines.push(`- その目標を選んだ理由: ${g.why}`);
  } else {
    lines.push('- 目標: まだ言葉にしていない（走力を聞き出し、サブ3までのギャップを示すところから始める）');
  }

  const upcoming = upcomingRaces(profile, now);
  if (upcoming.length > 0) {
    lines.push(`- 出場予定の大会（${upcoming.length}件）:`);
    for (const race of upcoming.slice(0, 8)) {
      lines.push(`  - ${describeRace(race, now)}`);
    }
  }
  const finished = pastRaces(profile, now);
  if (finished.length > 0) {
    lines.push(`- 走り終えた大会: ${finished.slice(0, 3).map((race) => describeRace(race, now)).join(' / ')}`);
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
        a.source === 'strava' ? '(Stravaから自動取込)' : null,
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

/**
 * ブラウザへ返してよい形のカルテ。
 *
 * 接続のトークンだけを落とす。**これを通さずに profile を返してはならない。**
 * 自分のトークンとはいえ、画面まで運ぶ理由がどこにも無い。
 */
export function publicProfile(profile: RunnerProfile): RunnerProfile {
  const strava = profile.connections?.strava;
  if (!strava) return profile;

  const connections: Connections = {
    strava: {
      athleteId: strava.athleteId,
      athleteName: strava.athleteName,
      connectedAt: strava.connectedAt,
      lastSyncedAt: strava.lastSyncedAt,
      imported: strava.imported,
    },
  };
  return { ...profile, connections };
}

/** 保存している Gemini の Content[] から、画面に出す発言だけを取り出す。 */
export function toDisplayMessages(
  history: Content[],
  attachments: AttachmentGroup[] = [],
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const byGroup = new Map(attachments.map((group) => [group.id, group.images]));

  history.forEach((content, index) => {
    const parts = (content.parts ?? []).filter(
      (part) => typeof part.text === 'string' && part.text.length > 0 && !part.thought,
    );

    const attachmentCount = parts.reduce(
      (total, part) => total + attachmentCountOf(part.text as string),
      0,
    );
    // 控えが残っていれば、送った時と同じように開ける。
    const previews = parts
      .map((part) => byGroup.get(attachmentGroupOf(part.text as string) ?? ''))
      .find((images) => images && images.length > 0);
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
      ...(previews && previews.length > 0 ? { imagePreviews: previews } : {}),
    });
  });
  return messages;
}
