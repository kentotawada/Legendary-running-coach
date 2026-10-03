'use client';

import { useMemo, useState } from 'react';
import type { GoalKind, RacePriority, RunnerProfile } from '@/lib/types';
import { RACE_PRIORITY_HINT, RACE_PRIORITY_LABEL, daysUntil, racesOf } from '@/lib/races';
import {
  COACH_CHARACTERS,
  DEFAULT_CHARACTER_ID,
  GENDER_LABEL,
  findCharacter,
  levelInfo,
} from '@/lib/characters';
import CoachAvatar from './CoachAvatar';
import {
  formatDuration,
  marathonPaceSeconds,
  parseDuration,
  summaryForTargetTime,
  targetTimeOptions,
  trainingPaces,
  vdotForTarget,
} from '@/lib/goals';

export interface RaceEdit {
  id?: string;
  name: string;
  date: string;
  distance?: string;
  targetTime?: string;
  priority: RacePriority;
  note?: string;
}

export interface ProfileEdit {
  characterId: string;
  /** 呼んでほしい名前。空文字は「消す」。 */
  displayName: string;
  goal: {
    kind: GoalKind;
    summary: string;
    targetTime?: string;
    targetPace?: string;
  } | null;
  races: RaceEdit[];
  injuryHistory: string[];
  maxHr?: string;
  lthr?: string;
  restingHr?: string;
  heightCm?: string;
  age?: string;
  sex?: 'male' | 'female' | '';
}

interface Props {
  profile: RunnerProfile | null;
  saving: boolean;
  onSave: (edit: ProfileEdit) => void;
  onCancel: () => void;
  /** 「やめる」の言い方。初回は「あとで」のほうが、進んでよいと分かる。 */
  cancelLabel?: string;
  /**
   * コーチを選ぶ欄を出すか。
   *
   * **選んだ直後の画面では隠す。** さっき顔を見て決めたばかりなのに、
   * 次の画面の先頭でまた8人が並ぶと、決まったのかどうかが分からなくなる。
   */
  showCoachPicker?: boolean;
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  /** 必須なら true、任意なら false。省略した項目にはラベルを付けない。 */
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block py-2">
      <span className="t-note font-medium">
        {label}
        {required !== undefined && (
          <span
            className={`ml-1.5 rounded px-1.5 py-0.5 t-note font-bold ${
              required ? 'bg-accent-soft text-accent' : 'bg-sunken text-muted'
            }`}
          >
            {required ? '必須' : '任意'}
          </span>
        )}
      </span>
      {hint && <span className="mt-0.5 block t-note leading-relaxed text-muted">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

const inputClass =
  'w-full rounded-xl border border-transparent bg-sunken px-3 py-2.5 text-fg outline-none focus:border-[color:var(--accent)]';

/**
 * 入力欄を複数抱える項目。
 * label で包むと、中のボタンを押しただけで先頭の入力欄が反応してしまうので、
 * 見た目だけ Field に揃えた div 版を用意する。
 */
/**
 * カルテの章。
 *
 * **18個の欄を平らに並べていた。** どこに何があるのか分からず、
 * 身長を入れたい人が最大心拍数の欄まで見ることになる。
 * 「自分のこと」「目標」「体のこと」に分けて、探す範囲を狭くする。
 */
function Chapter({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <div className="mb-1 border-b border-line pb-1.5">
        <h3 className="t-body font-bold">{title}</h3>
        {note && <p className="mt-0.5 t-note leading-relaxed text-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Section({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="block py-2">
      <span className="t-note font-medium">
        {label}
        <span className="ml-1.5 rounded bg-sunken px-1.5 py-0.5 t-note font-bold text-muted">任意</span>
      </span>
      {hint && <span className="mt-0.5 block t-note leading-relaxed text-muted">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

// ウルトラの目標時間も置けるよう、時間は 0〜23 まで用意する。
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => i);
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => i);
const SECOND_OPTIONS = Array.from({ length: 60 }, (_, i) => i);

function pad2(value: number): string {
  return `${value}`.padStart(2, '0');
}

/** "3:05:00" を 時・分・秒 に分ける。読めなければ未選択。 */
function splitDuration(value: string | undefined): { h: string; m: string; s: string } {
  const seconds = parseDuration(value);
  if (seconds === undefined) return { h: '', m: '', s: '' };
  return {
    h: String(Math.floor(seconds / 3600)),
    m: String(Math.floor((seconds % 3600) / 60)),
    s: String(seconds % 60),
  };
}

const timeSelectClass =
  'w-full appearance-none rounded-xl border border-transparent bg-sunken px-2 py-2.5 text-center text-fg outline-none focus:border-[color:var(--accent)]';

/**
 * タイムの入力。
 *
 * 文字入力にすると、スマホの数字キーボードにはコロンが無く「3:05:00」を打てない。
 * 時・分・秒を選ぶ形にすれば、キーボードを出さずに入るうえ、
 * 形式の崩れた値がそもそも作れなくなる。
 */
function TimePicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const [parts, setParts] = useState(() => splitDuration(value));

  const update = (patch: Partial<{ h: string; m: string; s: string }>) => {
    const next = { ...parts, ...patch };
    setParts(next);
    if (!next.h && !next.m && !next.s) {
      onChange('');
      return;
    }
    onChange(`${Number(next.h || 0)}:${pad2(Number(next.m || 0))}:${pad2(Number(next.s || 0))}`);
  };

  const columns: { key: 'h' | 'm' | 's'; unit: string; options: number[]; aria: string }[] = [
    { key: 'h', unit: '時間', options: HOUR_OPTIONS, aria: `${label}の時間` },
    { key: 'm', unit: '分', options: MINUTE_OPTIONS, aria: `${label}の分` },
    { key: 's', unit: '秒', options: SECOND_OPTIONS, aria: `${label}の秒` },
  ];

  return (
    <div className="flex items-center gap-1">
      {columns.map((column) => (
        <div key={column.key} className="flex min-w-0 flex-1 items-center gap-1">
          <select
            className={timeSelectClass}
            value={parts[column.key]}
            onChange={(e) => update({ [column.key]: e.target.value })}
            aria-label={column.aria}
          >
            <option value="">—</option>
            {column.options.map((option) => (
              <option key={option} value={String(option)}>
                {column.key === 'h' ? option : pad2(option)}
              </option>
            ))}
          </select>
          <span className="shrink-0 t-note text-muted">{column.unit}</span>
        </div>
      ))}
    </div>
  );
}

interface RaceDraft {
  /** React のキー。保存済みの大会は id、新規行は発行した一時キー。 */
  key: string;
  id?: string;
  name: string;
  date: string;
  distance: string;
  targetTime: string;
  priority: RacePriority;
  note: string;
}

let draftSeq = 0;

function emptyRace(): RaceDraft {
  draftSeq += 1;
  return {
    key: `new-${draftSeq}`,
    name: '',
    date: '',
    distance: '',
    targetTime: '',
    priority: 'A',
    note: '',
  };
}

const DISTANCE_OPTIONS = ['フル', 'ハーフ', '30km', '10km', '5km', 'ウルトラ', 'トレイル', '駅伝'];
const PRIORITIES: RacePriority[] = ['A', 'B', 'C'];

function RaceRow({
  race,
  onChange,
  onRemove,
}: {
  race: RaceDraft;
  onChange: (patch: Partial<RaceDraft>) => void;
  onRemove: () => void;
}) {
  const left = daysUntil(race.date);

  return (
    <div className="rounded-[14px] bg-sunken p-2.5">
      <div className="flex gap-2">
        <input
          className={inputClass}
          value={race.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="大会名（例: 東京マラソン）"
          aria-label="大会名"
        />
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded-xl bg-sunken px-3 t-note text-muted active:scale-[0.97]"
          aria-label={`${race.name || 'この大会'}を削除`}
        >
          削除
        </button>
      </div>

      <div className="mt-2 flex gap-2">
        <input
          className={inputClass}
          type="date"
          value={race.date}
          onChange={(e) => onChange({ date: e.target.value })}
          aria-label="開催日"
        />
        <select
          className={`${inputClass} appearance-none`}
          value={race.distance}
          onChange={(e) => onChange({ distance: e.target.value })}
          aria-label="種目"
        >
          <option value="">種目</option>
          {DISTANCE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
          {race.distance && !DISTANCE_OPTIONS.includes(race.distance) && (
            <option value={race.distance}>{race.distance}</option>
          )}
        </select>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {PRIORITIES.map((priority) => (
          <button
            key={priority}
            type="button"
            onClick={() => onChange({ priority })}
            className={[
              'rounded-full px-3 py-1.5 t-note transition active:scale-[0.97]',
              race.priority === priority
                ? 'bg-accent text-[var(--accent-fg)]'
                : 'bg-sunken text-muted',
            ].join(' ')}
          >
            {priority}・{RACE_PRIORITY_LABEL[priority]}
          </button>
        ))}
      </div>
      <p className="mt-1 t-note leading-relaxed text-muted">{RACE_PRIORITY_HINT[race.priority]}</p>

      <p className="mt-2.5 t-note text-muted">この大会の目標タイム（任意）</p>
      <div className="mt-1">
        <TimePicker
          value={race.targetTime}
          onChange={(targetTime) => onChange({ targetTime })}
          label="この大会の目標タイム"
        />
      </div>

      {left !== undefined && race.name.trim() && (
        <p className="mt-1.5 t-note text-muted">
          {left > 0 ? `本番まであと ${left} 日` : left === 0 ? '本番は今日です' : `${-left} 日前に終了`}
        </p>
      )}
    </div>
  );
}

export default function GoalEditor({
  profile,
  saving,
  onSave,
  onCancel,
  cancelLabel = 'やめる',
  showCoachPicker = true,
}: Props) {
  const goal = profile?.goal;
  const [kind, setKind] = useState<GoalKind>(goal?.kind ?? 'time');
  const [summary, setSummary] = useState(goal?.summary ?? '');
  const [targetTime, setTargetTime] = useState(goal?.targetTime ?? '');
  const [targetPace, setTargetPace] = useState(goal?.targetPace ?? '');
  // 出場する大会は複数ありうる。1件で上書きすると、他の大会の予定が消える。
  const [races, setRaces] = useState<RaceDraft[]>(() =>
    (profile ? racesOf(profile) : []).map((race) => ({
      key: race.id,
      id: race.id === 'legacy-goal-race' ? undefined : race.id,
      name: race.name,
      date: race.date,
      distance: race.distance ?? '',
      targetTime: race.targetTime ?? '',
      priority: race.priority,
      note: race.note ?? '',
    })),
  );
  const [characterId, setCharacterId] = useState(profile?.characterId ?? DEFAULT_CHARACTER_ID);
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');

  // 選んだコーチの敬称。呼び捨てで話す人は空文字なので、例文の出し方を変える。
  const chosen = findCharacter(characterId);
  const honorific = chosen.speech.honorific;
  const [injuries, setInjuries] = useState((profile?.injuryHistory ?? []).join('\n'));
  const [maxHr, setMaxHr] = useState(profile?.maxHr ? String(profile.maxHr) : '');
  const [lthr, setLthr] = useState(profile?.lthr ? String(profile.lthr) : '');
  const [restingHr, setRestingHr] = useState(profile?.restingHr ? String(profile.restingHr) : '');
  const [heightCm, setHeightCm] = useState(profile?.heightCm ? String(profile.heightCm) : '');
  const [age, setAge] = useState(profile?.age ? String(profile.age) : '');
  const [sex, setSex] = useState<'male' | 'female' | ''>(profile?.sex ?? '');

  const needsTime = kind === 'time' || kind === 'race';
  const timeIsValid = !targetTime.trim() || parseDuration(targetTime) !== undefined;

  const options = useMemo(() => targetTimeOptions(), []);
  const normalizedTime = useMemo(() => {
    const seconds = parseDuration(targetTime);
    return seconds === undefined ? '' : formatDuration(seconds);
  }, [targetTime]);
  // 選択肢に無いタイム（自由入力）を選んでいるかどうか。
  const isCustomTime = Boolean(targetTime.trim()) && !options.some((o) => o.value === normalizedTime);
  const [customTime, setCustomTime] = useState(isCustomTime);

  // 目標タイムを入れた瞬間に、コーチが使う基準が見えるようにする。
  const derived = useMemo(() => {
    if (!needsTime) return null;
    const seconds = marathonPaceSeconds(targetTime);
    if (seconds === undefined) return null;
    return trainingPaces(seconds);
  }, [needsTime, targetTime]);

  const vdot = useMemo(() => (needsTime ? vdotForTarget(targetTime) : undefined), [needsTime, targetTime]);

  const pickTime = (value: string) => {
    if (value === 'custom') {
      setCustomTime(true);
      return;
    }
    setCustomTime(false);
    setTargetTime(value);
    const seconds = parseDuration(value);
    // 目標名は選んだタイムから自動で作る。気に入らなければ下の欄で書き換えられる。
    if (seconds !== undefined) setSummary(summaryForTargetTime(seconds));
  };

  const KINDS: { value: GoalKind; label: string }[] = [
    { value: 'time', label: 'タイムを狙う' },
    { value: 'race', label: '完走したい' },
    { value: 'health', label: '健康維持・習慣化' },
  ];

  // 書きかけの行（名前だけ、日付だけ）は保存できない。黙って捨てると予定が消える。
  const incompleteRace = races.find(
    (race) => Boolean(race.name.trim()) !== Boolean(race.date.trim()),
  );
  const badRaceTime = races.find(
    (race) => race.targetTime.trim() && parseDuration(race.targetTime) === undefined,
  );
  const racesAreValid = !incompleteRace && !badRaceTime;

  const submit = () => {
    if (!timeIsValid || !racesAreValid) return;
    onSave({
      characterId,
      displayName: displayName.trim(),
      goal: {
        kind,
        summary: summary.trim() || '目標',
        targetTime: needsTime ? targetTime.trim() || undefined : undefined,
        targetPace: needsTime ? targetPace.trim() || undefined : undefined,
      },
      races: races
        .filter((race) => race.name.trim() && race.date.trim())
        .map((race) => ({
          id: race.id,
          name: race.name.trim(),
          date: race.date.trim(),
          distance: race.distance.trim() || undefined,
          targetTime: race.targetTime.trim() || undefined,
          priority: race.priority,
          note: race.note.trim() || undefined,
        })),
      injuryHistory: injuries.split('\n').map((line) => line.trim()).filter(Boolean),
      maxHr,
      lthr,
      restingHr,
      heightCm,
      age,
      sex,
    });
  };

  return (
    <div className="pb-4">
      <Chapter
        title="あなたのこと"
        note={showCoachPicker ? 'コーチと、呼んでほしい名前' : '呼んでほしい名前'}
      >
      {showCoachPicker && (
      <Field
        label="コーチのキャラクター"
        required={false}
        hint="変わるのは話し方と求める量だけです。指導の中身と安全のルールは同じです"
      >
        <div className="grid grid-cols-2 gap-2">
          {COACH_CHARACTERS.map((character) => {
            const active = characterId === character.id;
            return (
              <button
                key={character.id}
                type="button"
                onClick={() => setCharacterId(character.id)}
                className={[
                  'flex items-start gap-2.5 rounded-[14px] p-2.5 text-left transition active:scale-[0.98]',
                  active ? 'bg-accent-soft' : 'bg-sunken',
                ].join(' ')}
              >
                <CoachAvatar character={character} size={34} />
                <span className="min-w-0 flex-1">
                  <span className={`block t-note font-bold ${active ? 'text-accent' : ''}`}>
                    {character.name}
                    <span className="ml-1 align-middle t-note font-normal text-muted">
                      {GENDER_LABEL[character.gender]}
                    </span>
                    <span
                      className="ml-1 rounded-full px-1.5 py-px align-middle t-note font-bold"
                      style={{
                        background: `${levelInfo(character.level).color}1f`,
                        color: levelInfo(character.level).color,
                      }}
                    >
                      {levelInfo(character.level).label}
                    </span>
                  </span>
                  <span className="block t-note leading-snug text-muted">{character.tagline}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 t-note leading-relaxed text-muted">{chosen.description}</p>
      </Field>
      )}

      {/*
        呼び方。**コーチの隣に置く。** 誰に見てもらうかと、何と呼ばれたいかは
        ひと続きの話で、目標や心拍とは別の種類のもの。
      */}
      <Field
        label="呼んでほしい名前"
        required={false}
        hint={
          honorific
            ? `コーチはこの名前で呼びかけます。例:「${(displayName.trim() || '名前')}${honorific}、今日はどうでしたか」`
            : `${chosen.name}さんは呼び捨てで話します。例:「${displayName.trim() || '名前'}、今日はどうだった」`
        }
      >
        <input
          type="text"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="ニックネームでも構いません"
          maxLength={20}
          className={inputClass}
        />
      </Field>

      </Chapter>

      <Chapter title="目標" note="ここが変わると、コーチが使う基準も変わります">
      <Field label="何を目指しますか" required hint="選ぶと、コーチが使う基準がそれに合わせて切り替わります">
        <div className="flex flex-wrap gap-2">
          {KINDS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => {
                setKind(item.value);
                // 目標名が空のままにならないよう、種類に合わせた既定を入れておく。
                if (!summary.trim()) {
                  if (item.value === 'race') setSummary('フルマラソン完走');
                  if (item.value === 'health') setSummary('健康維持と走る習慣の定着');
                }
              }}
              className={[
                'rounded-full px-3.5 py-2 t-note transition active:scale-[0.97]',
                kind === item.value
                  ? 'bg-accent text-[var(--accent-fg)]'
                  : 'border-line bg-bg text-fg',
              ].join(' ')}
            >
              {item.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="目標の表現" required={false} hint="自分の言葉に変えても構いません。空欄なら目標タイムから自動で作ります">
        <input
          className={inputClass}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="例: 来年の東京マラソンでサブ4"
        />
      </Field>

      {needsTime && (
        <>
          <Field label="目標タイム" required hint="1時間55分から5時間30分まで5分刻み。スクロールして選べます">
            <select
              className={`${inputClass} appearance-none`}
              value={customTime ? 'custom' : normalizedTime}
              onChange={(e) => pickTime(e.target.value)}
              aria-label="目標タイム"
            >
              <option value="">選んでください</option>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              <option value="custom">その他（5分刻み以外のタイム）</option>
            </select>

            {customTime && (
              <div className="mt-2">
                <TimePicker value={targetTime} onChange={setTargetTime} label="目標タイム" />
              </div>
            )}

            {!timeIsValid && (
              <span className="mt-1 block t-note text-warn">
                目標タイムを選び直してください。
              </span>
            )}
          </Field>

          {derived && (
            <div className="my-2 rounded-xl bg-sunken px-3 py-2.5 t-note leading-relaxed text-muted">
              <p className="font-medium text-fg">この目標での基準ペース</p>
              <p>レースペース {derived.marathon} / 閾値走 {derived.threshold} / インターバル {derived.interval}</p>
              <p>イージー {derived.easyFrom} 〜 {derived.easyTo}</p>
              {vdot !== undefined && (
                <p className="mt-1">
                  必要な VDOT ≒ <span className="font-semibold text-fg">{vdot.toFixed(1)}</span>
                  <span className="block t-note">目標タイムから自動計算される走力指標です</span>
                </p>
              )}
            </div>
          )}

          <Field label="目標ペース" required={false} hint="空欄なら目標タイムから自動計算します">
            <input
              className={inputClass}
              value={targetPace}
              onChange={(e) => setTargetPace(e.target.value)}
              placeholder={derived ? derived.marathon : '5:41/km'}
            />
          </Field>

        </>
      )}

      <Section
        label="出場する大会"
        hint="何件でも登録できます。本命をA、練習として使う大会をB・Cにすると、そこから逆算して調整します"
      >
        <div className="space-y-2.5">
          {races.map((race, index) => (
            <RaceRow
              key={race.key}
              race={race}
              onChange={(patch) =>
                setRaces((current) =>
                  current.map((item, i) => (i === index ? { ...item, ...patch } : item)),
                )
              }
              onRemove={() => setRaces((current) => current.filter((_, i) => i !== index))}
            />
          ))}

          <button
            type="button"
            onClick={() => setRaces((current) => [...current, emptyRace()])}
            className="w-full rounded-xl border border-dashed border-line py-2.5 t-note text-muted active:scale-[0.99]"
          >
            ＋ 大会を追加
          </button>

          {incompleteRace && (
            <span className="block t-note text-warn">
              「{incompleteRace.name.trim() || '名称未入力の大会'}」は、大会名と開催日の両方が必要です。
            </span>
          )}
          {badRaceTime && (
            <span className="block t-note text-warn">
              「{badRaceTime.name.trim() || '大会'}」の目標タイムを選び直してください。
            </span>
          )}
        </div>
      </Section>

      </Chapter>

      <Chapter
        title="体のこと"
        note="一度入れれば、そう変わりません。入っているほど、コーチの判断が正確になります"
      >
      <Field
        label="故障歴・気になる部位"
        required={false}
        hint="1行に1件。負荷を上げる判断のたびにコーチが必ず考慮します"
      >
        <textarea
          className={`${inputClass} min-h-[88px] resize-y`}
          value={injuries}
          onChange={(e) => setInjuries(e.target.value)}
          placeholder={'右膝の外側（腸脛靭帯炎、2年前）\n左アキレス腱が張りやすい'}
        />
      </Field>

      {/*
        **ここは「1日に使う量」を出すためだけの欄。**
        指導の中身は変わらない。体脂肪率が分かっている人には、そもそも要らない。
        要らない人に埋めさせないよう、はじめからそう書く。
      */}
      <Field
        label="身長・年齢・性別"
        required={false}
        hint="1日に使うカロリーの計算にだけ使います。指導の中身は変わりません。体組成計で体脂肪率をはかっている人は、入れなくても大丈夫です"
      >
        <div className="flex gap-2">
          <label className="min-w-0 flex-1">
            <span className="mb-1 block t-note text-muted">身長(cm)</span>
            <input
              className={inputClass}
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
              placeholder="170"
              inputMode="numeric"
            />
          </label>
          <label className="min-w-0 flex-1">
            <span className="mb-1 block t-note text-muted">年齢</span>
            <input
              className={inputClass}
              value={age}
              onChange={(e) => setAge(e.target.value)}
              placeholder="38"
              inputMode="numeric"
            />
          </label>
        </div>
        <div className="mt-2 flex gap-2">
          {([
            ['male', '男性'],
            ['female', '女性'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setSex(sex === value ? '' : value)}
              aria-pressed={sex === value}
              className={[
                'flex-1 rounded-full px-4 py-2.5 t-note font-medium transition',
                sex === value
                  ? 'bg-accent text-[var(--accent-fg)]'
                  : 'bg-sunken',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
        {/* **身長を入れるいちばんの理由は、こちら。** */}
        <span className="mt-2 block t-note leading-relaxed text-muted">
          身長を入れると、減量の見込みを安全な下限（BMI 18.5）で止められます。
        </span>
      </Field>

      <Field
        label="最大心拍数"
        required
        hint="時計やランニングアプリで計測した最高心拍数。不明なら「220 − 年齢」が目安です"
      >
        <input
          className={inputClass}
          value={maxHr}
          onChange={(e) => setMaxHr(e.target.value)}
          placeholder="189"
          inputMode="numeric"
        />
        {!maxHr.trim() && (
          <span className="mt-1 block t-note leading-relaxed text-warn">
            未設定でも保存できますが、心拍ゾーンの評価ができません。
          </span>
        )}
      </Field>

      <Field
        label="LTHR（乳酸閾値心拍数）"
        required={false}
        hint="分からない場合は空欄でOK。最大心拍数から推定して計算します"
      >
        <input
          className={inputClass}
          value={lthr}
          onChange={(e) => setLthr(e.target.value)}
          placeholder={maxHr.trim() ? `${Math.round(Number(maxHr) * 0.89) || ''}（推定値）` : '172'}
          inputMode="numeric"
        />
      </Field>

      <Field
        label="安静時心拍数"
        required={false}
        hint="睡眠時・起床時の心拍数。分からない場合は空欄でOK。入力するとゾーンの精度が上がります"
      >
        <input
          className={inputClass}
          value={restingHr}
          onChange={(e) => setRestingHr(e.target.value)}
          placeholder="44"
          inputMode="numeric"
        />
      </Field>

      </Chapter>

      {/*
        **毎日の記録は、ここには無い。** 体重・体脂肪率・食べた量は
        日によって変わるので、頭の列のスタンプから入れる。
        探し回らせないよう、ここにも行き先を書いておく。
      */}
      <p className="mt-5 rounded-[12px] bg-sunken px-3.5 py-3 t-note leading-relaxed text-muted">
        <strong className="font-semibold text-fg">体重・体脂肪率・食べた量は、ここではありません。</strong>
        毎日変わるものなので、画面の上の「スタンプ」から入れてください。
        走った記録は、入力欄の「＋」から送れます。
      </p>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={saving || !timeIsValid || !racesAreValid}
          className="flex-1 rounded-full bg-accent px-4 py-3 t-body font-semibold text-[var(--accent-fg)] disabled:opacity-40"
        >
          {saving ? '保存しています…' : '保存する'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex-1 rounded-full bg-sunken px-4 py-3 t-body"
        >
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
