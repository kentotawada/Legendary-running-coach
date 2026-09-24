/**
 * 本番までの持ち物と段取り。
 *
 * レース直前に何を忘れるかは、だいたい決まっています。
 * そして直前ほど、決まっていないことを自分で考える余裕がありません。
 *
 * ここで出すのは一般的なリストではなく、**この人の計算結果**です。
 * ジェルの本数は目標タイムから、シューズの状態は積んだ距離から、
 * 入りのペースは目標ペースから出しています。
 */

import type { RunnerProfile } from './types';
import { fuelPlanFor, raceDistanceKm } from './gear-spec';
import { daysUntil, targetRace } from './races';
import { formatPace, marathonPaceSeconds, parseDuration } from './goals';
import { SHOE_ROLE_LABEL, activeShoes, shoeStatusOf } from './shoes';
import { mapFencedBlocks } from './fences';

export interface ChecklistItem {
  label: string;
  /** その人の数字。無ければ一般的な項目としてだけ出す。 */
  detail?: string;
}

export interface ChecklistSection {
  title: string;
  items: ChecklistItem[];
}

export interface RaceChecklist {
  race: string;
  date: string;
  daysLeft: number;
  sections: ChecklistSection[];
  /** チェックの状態を端末に覚えさせるための鍵。大会ごとに変わる。 */
  key: string;
}

/** 何日前から出す意味があるか。これより先だと、やることが変わってしまう。 */
export const CHECKLIST_WINDOW_DAYS = 21;

function fuelSection(profile: RunnerProfile, now: Date): ChecklistSection | null {
  const plan = fuelPlanFor(profile, now);
  if (!plan) return null;

  const items: ChecklistItem[] = [
    {
      label: `ジェル ${plan.gels}本`,
      detail: `${plan.intervalMin}分おきに1本。想定${Math.floor(plan.minutes / 60)}時間${`${plan.minutes % 60}`.padStart(2, '0')}分・糖質${plan.totalCarbs}gから`,
    },
    {
      label: 'うちカフェイン入りは1〜2本',
      detail:
        plan.caffeineCapMg !== undefined
          ? `合計${plan.caffeineCapMg}mgまで。効かせたい後半に回す`
          : '効かせたい後半に回す',
    },
    { label: 'ジェルを入れる物', detail: 'ポケットかポーチ。走りながら出せるか、一度着て確かめる' },
    { label: 'エイドで取る物を決めておく', detail: `飲み物で約${plan.drinkCarbs}g分を見込んでいる` },
  ];
  return { title: '補給（計算済み）', items };
}

function shoeSection(profile: RunnerProfile, now: Date): ChecklistSection {
  const items: ChecklistItem[] = [];
  const race = activeShoes(profile).filter((shoe) => shoe.role === 'race');

  if (race.length === 0) {
    items.push({
      label: '当日履く靴を決める',
      detail: '本番で初めて履かない。最低1回はレースペースで履いて、当たる場所が無いか確かめる',
    });
  } else {
    for (const shoe of race) {
      const status = shoeStatusOf(shoe, profile);
      items.push({
        label: `${shoe.name}（${SHOE_ROLE_LABEL[shoe.role]}）`,
        detail:
          shoe.km <= 0
            ? '本番が初おろしになる。レースペースで一度は履いてから当日を迎える'
            : status.level === 'over'
              ? `累計${Math.round(shoe.km)}km。目安${status.lifespan.replace}kmを超えている。反発はもう残っていない`
              : `累計${Math.round(shoe.km)}km。目安${status.lifespan.replace}kmまで残り${status.remainingKm}km`,
      });
    }
  }

  items.push(
    { label: '替えの靴下', detail: '雨なら必須。当日の朝まで履かない新品は使わない' },
    { label: 'ワセリン', detail: '内もも・脇・靴擦れしやすい所。塗り忘れは42kmで効いてくる' },
    { label: '絆創膏・テーピング', detail: '使い慣れている物だけ。新しい貼り方を本番で試さない' },
  );
  return { title: 'シューズと身につける物', items };
}

function kitSection(): ChecklistSection {
  return {
    title: '持ち物',
    items: [
      { label: 'ゼッケン・参加案内', detail: '前日のうちにウェアへ留めておく' },
      { label: '安全ピン', detail: '会場で配られない大会もある' },
      { label: '時計（充電）', detail: 'フル4時間ならGPSの電池が足りるか確かめる' },
      { label: '着替え・タオル', detail: 'ゴール後に冷える。上に羽織る物を必ず' },
      { label: 'ビニール袋', detail: 'スタート前の防寒と、濡れた物を入れる用' },
      { label: '現金・交通系IC', detail: '会場は電波が弱い。決済できない前提で持つ' },
    ],
  };
}

function morningSection(profile: RunnerProfile, now: Date): ChecklistSection {
  const race = targetRace(profile, now);
  const distanceKm = raceDistanceKm(race);
  const pace = marathonPaceSeconds(profile.goal?.targetTime);
  const raceSeconds = parseDuration(race?.targetTime);
  const racePace =
    raceSeconds !== undefined && distanceKm !== undefined && distanceKm > 0
      ? raceSeconds / distanceKm
      : pace;

  const items: ChecklistItem[] = [
    { label: '起床はスタート3時間前', detail: '内臓が動き出すまでに時間が要る' },
    { label: '朝食は3時間前までに', detail: 'いつも通りの物だけ。新しい物を食べない' },
    { label: 'トイレは2回', detail: '会場の列は長い。着いたらまず並ぶ' },
  ];

  if (racePace !== undefined) {
    items.push({
      label: '入りのペースを決めておく',
      detail: `最初の5kmは ${formatPace(racePace + 5)} まで。目標は ${formatPace(racePace)}。前半の貯金は必ず利息付きで返ってくる`,
    });
  }

  const pains = profile.pains.filter((pain) => pain.status !== 'resolved' && pain.severity >= 1);
  if (pains.length > 0) {
    items.push({
      label: `${pains.map((pain) => pain.site).join('・')}の様子を見る`,
      detail: '走っていて痛みが強くなったら止める。完走より、来年も走れる体の方が重い',
    });
  }

  return { title: '当日の朝', items };
}

function avoidSection(profile: RunnerProfile, now: Date): ChecklistSection {
  const left = daysUntil(targetRace(profile, now)?.date, now) ?? 0;
  return {
    title: 'やらないこと',
    items: [
      { label: '新しい物を本番で試さない', detail: 'ジェル・靴下・ウェア・サプリ。すべて練習で使った物だけ' },
      { label: '前日に長く歩かない', detail: '会場の受付や観光で、気づかないうちに脚を使う' },
      {
        label: '足りない練習を今から足さない',
        detail:
          left <= 7
            ? 'レース週の練習で走力は上がらない。上がるのは疲労だけ'
            : '距離を減らして刺激だけ残す。走り足りない焦りは、この時期に必ず出る',
      },
    ],
  };
}

/**
 * Aレースの持ち物リスト。
 * 本番が決まっていなければ何も作らない。一般的なリストは、ここでは価値にならない。
 */
export function raceChecklistFor(profile: RunnerProfile, now: Date = new Date()): RaceChecklist | null {
  const race = targetRace(profile, now);
  const left = daysUntil(race?.date, now);
  if (!race || left === undefined || left < 0) return null;

  const sections = [
    fuelSection(profile, now),
    shoeSection(profile, now),
    kitSection(),
    morningSection(profile, now),
    avoidSection(profile, now),
  ].filter((section): section is ChecklistSection => section !== null);

  return {
    race: race.name,
    date: race.date,
    daysLeft: left,
    sections,
    key: `${race.name}:${race.date}`,
  };
}

/** 本文の checklist ブロックを、この人のリストに差し替える。 */
export function resolveChecklistBlocks(
  text: string,
  profile: RunnerProfile,
  now: Date = new Date(),
): string {
  return mapFencedBlocks(text, 'checklist', (raw) => {
    // すでに中身が入っているもの（保存済みの履歴）はそのまま。
    // ただし、こちらが書いた印（computed）が無いものは作り直す。
    // モデルが自分で書いたリストだと、本数や距離が計算結果と食い違う。
    try {
      const data = JSON.parse(raw) as { sections?: unknown; computed?: unknown };
      if (Array.isArray(data.sections) && data.computed === true) return raw;
    } catch {
      // 空や壊れた JSON でも、リストが作れるなら作る。
    }
    const checklist = raceChecklistFor(profile, now);
    return checklist ? JSON.stringify({ computed: true, ...checklist }) : null;
  });
}

/** プロンプトに差し込む、持ち物リストの出し方。 */
export function checklistDoctrine(profile: RunnerProfile, now: Date = new Date()): string | null {
  const checklist = raceChecklistFor(profile, now);
  if (!checklist) return null;

  const lines = [
    '# 本番の持ち物と段取り',
    `- ${checklist.race}まであと${checklist.daysLeft}日。下のブロックを出すと、この人用のリストがアプリ側で作られる。`,
    '',
    '```checklist',
    '{}',
    '```',
    '',
    '- 中身は書かなくてよい（書いても差し替えられる）。ジェルの本数もシューズの走行距離も計算済み。',
    '- 出すのは、本人が持ち物や当日の段取りを気にした時、または本番2週間前を切ってから一度だけ。',
    '  毎回出さない。リストを見せること自体が目的ではない。',
  ];

  if (checklist.daysLeft <= 14) {
    lines.push(
      `- **あと${checklist.daysLeft}日。** まだ一度も渡していなければ、この会話のどこかで一度渡しておくこと。`,
    );
  }
  return lines.join('\n');
}
