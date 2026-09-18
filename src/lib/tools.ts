import type { FunctionDeclaration } from '@google/genai';
import type {
  ActivitySource,
  ActivityType,
  CoachingPhase,
  PainStatus,
  PlanIntensity,
  RacePriority,
  RunnerProfile,
} from './types';
import {
  addActivity,
  addConditionLog,
  addRace,
  applyProfileUpdate,
  removeRace,
  setPhase,
  setPlan,
  today,
  upsertPain,
} from './profile';
import { logWeight } from './daily';

/**
 * コーチが「学習」するための手段。
 * 会話から拾った事実をここでカルテに落とし込み、次のターン以降の文脈にする。
 */
export const coachTools: FunctionDeclaration[] = [
  {
    name: 'update_runner_profile',
    description:
      'ランナーの目標・経験・走行距離・体重・自己ベスト・使える曜日や時間・生活上の制約・走る理由が分かった時に記録する。分かった項目だけを渡すこと。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        displayName: { type: 'string', description: '呼んでほしい名前' },
        experience: { type: 'string', description: 'ランニング歴や運動経験' },
        weeklyVolumeKm: { type: 'number', description: 'week あたりの走行距離(km)' },
        bodyWeightKg: { type: 'number' },
        maxHr: { type: 'number', description: '最大心拍数(bpm)。心拍ゾーン評価に必須。' },
        restingHr: { type: 'number', description: '安静時心拍数(bpm)。疲労の蓄積を測る指標。' },
        lthr: { type: 'number', description: '乳酸性作業閾値心拍(bpm)。閾値走の強度設定に使う。' },
        injuryHistory: {
          type: 'array',
          items: { type: 'string' },
          description: '過去の故障歴。例: ["腸脛靭帯炎（右膝）", "足底腱膜炎"]',
        },
        personalBests: {
          type: 'object',
          description: '種目をキー、タイムを値にした自己ベスト。例: {"5km": "24:30", "full": "3:25:00"}',
          additionalProperties: { type: 'string' },
        },
        availableDays: {
          type: 'array',
          items: { type: 'string' },
          description: '走れる曜日。例: ["火", "木", "日"]',
        },
        typicalSessionMinutes: { type: 'number', description: '1回の練習に使える時間(分)' },
        constraints: {
          type: 'array',
          items: { type: 'string' },
          description: '生活上の制約。例: ["平日は朝しか時間がない", "子どもの送迎がある"]',
        },
        motivations: {
          type: 'array',
          items: { type: 'string' },
          description: '走る理由・原動力。目的の変化を捉えるために残す。',
        },
        goal: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: ['race', 'time', 'health', 'habit', 'none'],
              description: 'race=大会完走, time=タイム目標, health=健康, habit=習慣化, none=目標なし',
            },
            summary: { type: 'string', description: '「サブスリー達成」など一言で' },
            raceName: { type: 'string', description: '出場する大会名。複数の大会は add_race で1件ずつ登録すること。' },
            raceDate: { type: 'string', description: 'YYYY-MM-DD' },
            targetTime: { type: 'string', description: '"2:59:59" 形式' },
            why: { type: 'string', description: 'なぜその目標なのか' },
          },
        },
      },
    },
  },
  {
    name: 'add_race',
    description:
      '出場する大会が分かった時に1件ずつ登録する。複数の大会にエントリーしている人は珍しくないので、' +
      '新しい大会を聞くたびに呼ぶこと。既存の大会を置き換えてはならない。' +
      'priority は、狙っている大会が A、練習として使う大会が B か C。どれを本命にするかは必ず本人に確かめる。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '大会名。例: "東京マラソン"' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        distance: { type: 'string', description: '"フル" / "ハーフ" / "30km" / "ウルトラ" など' },
        targetTime: { type: 'string', description: 'その大会での目標タイム。"3:29:59" 形式。' },
        priority: {
          type: 'string',
          enum: ['A', 'B', 'C'],
          description: 'A=本命（ここに合わせて仕上げる）, B=調整レース, C=練習の一環',
        },
        note: { type: 'string', description: '高低差・気温・制限時間など、当日を左右する条件' },
      },
      required: ['name', 'date'],
    },
  },
  {
    name: 'remove_race',
    description: '出場しないことになった大会を一覧から外す。本人が「出ない」と言った時だけ呼ぶこと。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '外す大会名' },
      },
      required: ['name'],
    },
  },
  {
    name: 'log_condition',
    description:
      '今日の体調・気分・使える時間を記録する。「忙しい」「疲れた」「やる気が出ない」という訴えも必ずここに残すこと。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD。省略時は今日。' },
        fatigue: { type: 'number', description: '疲労度 0-5。5が最も疲れている。' },
        sleepHours: { type: 'number' },
        mood: { type: 'string', description: '本人の言葉のまま' },
        availableMinutes: { type: 'number', description: '今日使える時間(分)。0なら完全休養。' },
        note: { type: 'string' },
      },
    },
  },
  {
    name: 'update_pain',
    description:
      '痛み・違和感の訴えを聞いた時、または痛みが軽くなった / 治った時に記録する。同じ部位は上書きされる。治った場合は severity 0 / status resolved。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: '部位。例: "右膝の外側"' },
        severity: { type: 'number', description: '0-5。0は解消。1以上ある限り走行メニューは出せない。' },
        status: { type: 'string', enum: ['active', 'improving', 'resolved'] },
        description: { type: 'string', description: 'どんな時にどう痛むか' },
        since: { type: 'string', description: 'いつから' },
      },
      required: ['site', 'severity'],
    },
  },
  {
    name: 'log_activity',
    description:
      '練習の報告を受けた時、およびランニングアプリのスクリーンショットから数値を読み取った時に記録する。' +
      '読み取れなかった項目は空のままにすること。推測した数値を入れてはならない。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD。省略時は今日。' },
        type: {
          type: 'string',
          enum: ['run', 'walk', 'cross', 'strength', 'stretch', 'rest'],
        },
        session: {
          type: 'string',
          description: 'ポイント練習の種別。例: "閾値走", "インターバル", "ロング走", "レースペース走", "イージー"',
        },
        distanceKm: { type: 'number' },
        durationMin: { type: 'number' },
        effort: { type: 'number', description: '主観的運動強度 1-10' },
        felt: { type: 'string', description: '本人の感覚。数値に出ない情報として重視する。' },
        source: {
          type: 'string',
          enum: ['self-report', 'screenshot'],
          description: '画像から読み取った場合は screenshot。',
        },
        metrics: {
          type: 'object',
          description: '計測データ。読み取れた項目だけを入れる。',
          properties: {
            avgPace: { type: 'string', description: '"4:15/km" 形式の平均ペース' },
            avgHr: { type: 'number', description: '平均心拍(bpm)' },
            maxHr: { type: 'number', description: '最高心拍(bpm)' },
            cadence: { type: 'number', description: 'ピッチ(spm)' },
            strideM: { type: 'number', description: 'ストライド(m)' },
            elevationGainM: { type: 'number', description: '獲得標高(m)' },
            note: { type: 'string', description: '接地時間・上下動・気温など、上の枠に入らない補足' },
          },
        },
      },
      required: ['type'],
    },
  },
  {
    name: 'set_today_plan',
    description:
      'その日のメニューを提示した時に記録する。alternatives には「時間が取れない時」「疲れが強い時」の逃げ道を必ず入れる。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD。省略時は今日。' },
        title: { type: 'string' },
        steps: { type: 'array', items: { type: 'string' }, description: '実際にやることの手順' },
        rationale: { type: 'string', description: 'なぜこのメニューなのかの根拠' },
        intensity: { type: 'string', enum: ['rest', 'easy', 'moderate', 'hard'] },
        estimatedMinutes: { type: 'number' },
        alternatives: {
          type: 'array',
          description: '条件付きの代替案',
          items: {
            type: 'object',
            properties: {
              when: { type: 'string', description: '例: "時間が20分しか取れない時"' },
              what: { type: 'string', description: '例: "ストレッチ5分だけでOK"' },
            },
            required: ['when', 'what'],
          },
        },
      },
      required: ['title', 'steps', 'rationale', 'intensity'],
    },
  },
  {
    name: 'log_weight',
    description:
      '体重を聞いた時に記録する。増減を評価するためではなく、はかる習慣を支えるために残す。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        weightKg: { type: 'number', description: '体重(kg)' },
        date: { type: 'string', description: 'YYYY-MM-DD。省略時は今日。' },
      },
      required: ['weightKg'],
    },
  },
  {
    name: 'set_coaching_phase',
    description:
      '目的や心境が変わったと判断した時にフェーズを切り替える。reason にはこの人の言葉をそのまま残すこと。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        phase: {
          type: 'string',
          enum: ['unknown', 'habit', 'goal', 'recovery'],
          description: 'habit=目標なし/習慣化, goal=明確な目標あり, recovery=痛みからの回復期',
        },
        reason: { type: 'string', description: 'そう判断した理由。本人の言葉を優先。' },
      },
      required: ['phase', 'reason'],
    },
  },
];

type Args = Record<string, unknown>;

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function strArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map((v) => str(v)).filter((v): v is string => Boolean(v));
  return items.length > 0 ? items : undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  const s = str(value);
  return s && (allowed as readonly string[]).includes(s) ? (s as T) : undefined;
}

const ACTIVITY_TYPES = ['run', 'walk', 'cross', 'strength', 'stretch', 'rest'] as const;
const ACTIVITY_SOURCES = ['self-report', 'screenshot'] as const;
const INTENSITIES = ['rest', 'easy', 'moderate', 'hard'] as const;
const PAIN_STATUSES = ['active', 'improving', 'resolved'] as const;
const PHASES = ['unknown', 'habit', 'goal', 'recovery'] as const;
const RACE_PRIORITIES = ['A', 'B', 'C'] as const;

export interface ToolOutcome {
  profile: RunnerProfile;
  /** モデルに返す functionResponse の中身。 */
  result: Record<string, unknown>;
}

/**
 * ツール実行。モデルは型を守らないことがあるので、すべての値を検証してから通す。
 * 未知のツール名や壊れた引数でも例外を投げず、error を返してモデルに立て直させる。
 */
export function executeTool(
  profile: RunnerProfile,
  name: string,
  rawArgs: unknown,
  now: Date = new Date(),
): ToolOutcome {
  const args: Args = rawArgs && typeof rawArgs === 'object' ? (rawArgs as Args) : {};

  switch (name) {
    case 'update_runner_profile': {
      const goalRaw = args.goal as Args | undefined;
      const goal = goalRaw
        ? {
            kind: oneOf(goalRaw.kind, ['race', 'time', 'health', 'habit', 'none'] as const),
            summary: str(goalRaw.summary),
            raceName: str(goalRaw.raceName),
            raceDate: str(goalRaw.raceDate),
            targetTime: str(goalRaw.targetTime),
            why: str(goalRaw.why),
          }
        : undefined;

      const personalBests =
        args.personalBests && typeof args.personalBests === 'object'
          ? Object.fromEntries(
              Object.entries(args.personalBests as Args)
                .map(([k, v]) => [k, str(v)])
                .filter(([, v]) => Boolean(v)) as [string, string][],
            )
          : undefined;

      let next = applyProfileUpdate(
        profile,
        {
          displayName: str(args.displayName),
          experience: str(args.experience),
          weeklyVolumeKm: num(args.weeklyVolumeKm),
          bodyWeightKg: num(args.bodyWeightKg),
          maxHr: num(args.maxHr),
          restingHr: num(args.restingHr),
          lthr: num(args.lthr),
          injuryHistory: strArray(args.injuryHistory),
          personalBests: personalBests && Object.keys(personalBests).length > 0 ? personalBests : undefined,
          availableDays: strArray(args.availableDays),
          typicalSessionMinutes: num(args.typicalSessionMinutes),
          constraints: strArray(args.constraints),
          motivations: strArray(args.motivations),
          goal,
        },
        now,
      );

      // 大会は一覧で持つ。ここで受け取った1件も、既存の大会を消さずに追加する。
      const raceName = str(goalRaw?.raceName);
      const raceDate = str(goalRaw?.raceDate);
      if (raceName && raceDate) {
        next = addRace(next, { name: raceName, date: raceDate, priority: 'A' }, now);
      }

      return {
        profile: next,
        result: {
          ok: true,
          message:
            raceName && !raceDate
              ? 'カルテを更新した。ただし大会は日付が無いと登録できない。開催日を尋ねて add_race で登録すること。'
              : 'カルテを更新した',
        },
      };
    }

    case 'add_race': {
      const name = str(args.name);
      const date = str(args.date);
      if (!name || !date) {
        return { profile, result: { ok: false, error: 'name と date（YYYY-MM-DD）は必須。' } };
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return { profile, result: { ok: false, error: '日付は YYYY-MM-DD で渡すこと。' } };
      }
      const next = addRace(
        profile,
        {
          name,
          date,
          distance: str(args.distance),
          targetTime: str(args.targetTime),
          priority: oneOf<RacePriority>(args.priority, RACE_PRIORITIES) ?? 'A',
          note: str(args.note),
        },
        now,
      );
      const count = next.races?.length ?? 0;
      return {
        profile: next,
        result: {
          ok: true,
          raceCount: count,
          message:
            count > 1
              ? `大会を登録した（計${count}件）。どれを本命（A）にするかが未確定なら必ず確かめ、他の大会の位置づけも言葉にすること。`
              : '大会を登録した。本番から逆算して、いま何を積む時期かを伝えること。',
        },
      };
    }

    case 'remove_race': {
      const name = str(args.name);
      if (!name) return { profile, result: { ok: false, error: 'name は必須。' } };
      const target = (profile.races ?? []).find((race) => race.name === name);
      if (!target) {
        return { profile, result: { ok: false, error: `「${name}」は登録されていない。登録済みの大会名を確かめること。` } };
      }
      return { profile: removeRace(profile, target.id, now), result: { ok: true, message: '大会を一覧から外した' } };
    }

    case 'log_condition': {
      const next = addConditionLog(
        profile,
        {
          date: str(args.date) ?? today(now),
          fatigue: num(args.fatigue),
          sleepHours: num(args.sleepHours),
          mood: str(args.mood),
          availableMinutes: num(args.availableMinutes),
          note: str(args.note),
        },
        now,
      );
      return { profile: next, result: { ok: true, message: '今日のコンディションを記録した' } };
    }

    case 'update_pain': {
      const site = str(args.site);
      const severity = num(args.severity);
      if (!site || severity === undefined) {
        return {
          profile,
          result: { ok: false, error: 'site と severity は必須。痛みの部位と強さ(0-5)を聞き直すこと。' },
        };
      }
      const next = upsertPain(
        profile,
        {
          site,
          severity,
          status: oneOf<PainStatus>(args.status, PAIN_STATUSES),
          description: str(args.description),
          since: str(args.since),
        },
        now,
      );
      const stillHurting = next.pains.some((p) => p.status !== 'resolved' && p.severity >= 1);
      return {
        profile: next,
        result: {
          ok: true,
          runningAllowed: !stillHurting,
          message: stillHurting
            ? '痛みを記録した。走行メニューは一切提案してはならない。'
            : '痛みの解消を記録した。ただし再開は段階的に、短く軽いところから。',
        },
      };
    }

    case 'log_activity': {
      const type = oneOf<ActivityType>(args.type, ACTIVITY_TYPES);
      if (!type) {
        return { profile, result: { ok: false, error: `type は ${ACTIVITY_TYPES.join(' / ')} のいずれか。` } };
      }
      const rawMetrics = (args.metrics && typeof args.metrics === 'object' ? args.metrics : {}) as Args;
      const metrics = {
        avgPace: str(rawMetrics.avgPace),
        avgHr: num(rawMetrics.avgHr),
        maxHr: num(rawMetrics.maxHr),
        cadence: num(rawMetrics.cadence),
        strideM: num(rawMetrics.strideM),
        elevationGainM: num(rawMetrics.elevationGainM),
        note: str(rawMetrics.note),
      };
      const hasMetrics = Object.values(metrics).some((value) => value !== undefined);

      const next = addActivity(
        profile,
        {
          date: str(args.date) ?? today(now),
          type,
          session: str(args.session),
          distanceKm: num(args.distanceKm),
          durationMin: num(args.durationMin),
          effort: num(args.effort),
          felt: str(args.felt),
          metrics: hasMetrics ? metrics : undefined,
          source: oneOf<ActivitySource>(args.source, ACTIVITY_SOURCES),
        },
        now,
      );

      // 心拍ゾーンの評価には基準値が要る。持っていないなら、推測させずに尋ねさせる。
      const needsHrReference =
        metrics.avgHr !== undefined && next.maxHr === undefined && next.lthr === undefined;

      return {
        profile: next,
        result: {
          ok: true,
          needsHrReference,
          message: needsHrReference
            ? '練習を記録した。ただし最大心拍もLTHRも未取得のため、心拍ゾーンの評価はできない。推測せずに基準値を尋ねること。'
            : '練習を記録した。狙いに対して成立したかを、数字を挙げて評価すること。',
        },
      };
    }

    case 'set_today_plan': {
      const title = str(args.title);
      const steps = strArray(args.steps);
      const rationale = str(args.rationale);
      const intensity = oneOf<PlanIntensity>(args.intensity, INTENSITIES);
      if (!title || !steps || !rationale || !intensity) {
        return {
          profile,
          result: { ok: false, error: 'title / steps / rationale / intensity は必須。' },
        };
      }
      const alternatives = Array.isArray(args.alternatives)
        ? (args.alternatives as Args[])
            .map((alt) => ({ when: str(alt?.when), what: str(alt?.what) }))
            .filter((alt): alt is { when: string; what: string } => Boolean(alt.when && alt.what))
        : undefined;

      const next = setPlan(
        profile,
        {
          date: str(args.date) ?? today(now),
          title,
          steps,
          rationale,
          intensity,
          estimatedMinutes: num(args.estimatedMinutes),
          alternatives,
        },
        now,
      );
      return {
        profile: next,
        result: {
          ok: true,
          message:
            alternatives && alternatives.length > 0
              ? 'メニューを記録した'
              : 'メニューを記録した。ただし代替案が未設定。返答の中で「時間が取れない時」の逃げ道を必ず添えること。',
        },
      };
    }

    case 'log_weight': {
      const weightKg = num(args.weightKg);
      if (weightKg === undefined || weightKg < 20 || weightKg > 250) {
        return { profile, result: { ok: false, error: '体重は 20〜250kg の範囲で受け取る。' } };
      }
      const next = logWeight(profile, Math.round(weightKg * 10) / 10, str(args.date) ?? today(now), now);
      return {
        profile: next,
        result: {
          ok: true,
          message: '体重を記録した。増減ではなく、はかったこと自体を評価すること。',
        },
      };
    }

    case 'set_coaching_phase': {
      const phase = oneOf<CoachingPhase>(args.phase, PHASES);
      const reason = str(args.reason);
      if (!phase || !reason) {
        return { profile, result: { ok: false, error: 'phase と reason は必須。' } };
      }
      const next = setPhase(profile, phase, reason, now);
      return {
        profile: next,
        result: {
          ok: true,
          changed: next !== profile,
          message:
            next !== profile && phase === 'goal'
              ? 'フェーズを更新した。この心境の変化を、まず心から一緒に喜ぶこと。'
              : 'フェーズを更新した',
        },
      };
    }

    default:
      return { profile, result: { ok: false, error: `未知のツール: ${name}` } };
  }
}
