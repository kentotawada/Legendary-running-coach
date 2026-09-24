import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AttachmentGroup, CoachState, RunnerProfile } from './types';
import { createDefaultProfile } from './types';
import type { Content, Part } from '@google/genai';
import { imagePlaceholder } from './markers';
import { createSupabaseAdminClient } from './supabase';
import { SupabaseCoachStore } from './store-supabase';

/**
 * 保存層。いまは JSON ファイルだが、
 * iOS / Android から同じ API を叩く時に DB へ差し替えられるよう、
 * インタフェースだけ切っておく。
 */
export interface CoachStore {
  load(userId: string): Promise<CoachState>;
  /** authUserId はログイン済みの場合のみ渡す。保存層が持ち主を記録できるようにするため。 */
  save(userId: string, state: CoachState, authUserId?: string): Promise<void>;
  reset(userId: string): Promise<void>;
  /**
   * 未ログインで貯めた記録を、ログイン後のアカウントへ引き継ぐ。
   * 引き継いだら true。引き継ぎ先にすでに記録がある場合は、上書きせず false。
   */
  adopt(fromUserId: string, toUserId: string, authUserId?: string): Promise<boolean>;
  /**
   * 通知のような、全員を一度に見る処理のための一覧。
   * 会話履歴は重いので、カルテだけを返す。
   */
  listProfiles?(limit?: number): Promise<{ userId: string; profile: RunnerProfile }[]>;
  /** カルテだけを書き戻す。履歴を読み込まずに済ませるため。 */
  saveProfile?(userId: string, profile: RunnerProfile): Promise<void>;
}

/** モデルに渡す会話の上限。これを超えたら古い順に落とす。 */
const MAX_HISTORY_CONTENTS = 80;

export function trimHistory(history: Content[], max: number = MAX_HISTORY_CONTENTS): Content[] {
  if (history.length <= max) return history;
  // functionCall とその functionResponse が分断されないよう、user 発言の境目まで戻す。
  let start = history.length - max;
  while (start < history.length && history[start].role !== 'user') start += 1;
  return history.slice(start === history.length ? history.length - max : start);
}

/**
 * 保存する履歴から画像の本体を落とす。
 * base64 を抱えたまま保存すると、保存先がすぐに膨れ上がる。
 * 読み取った数値はカルテに残っているので、ここでは「添付があった」跡だけを残す。
 */
export function stripInlineData(history: Content[], group?: string): Content[] {
  return history.map((content) => {
    const parts = content.parts ?? [];
    const imageCount = parts.filter((part) => part.inlineData).length;
    if (imageCount === 0) return content;

    // 本体を落とす代わりに、見返し用の控えへの手がかりを残す。
    const kept: Part[] = [{ text: imagePlaceholder(imageCount, group) }];
    for (const part of parts) {
      if (!part.inlineData) kept.push(part);
    }
    return { ...content, parts: kept };
  });
}

/**
 * 控えを保存できる量に収める。
 * 際限なく貯めると保存先の1行が膨れ、読み書きそのものが遅くなる。
 * 新しいものから順に入れて、入らなくなったところで切る。
 */
export const MAX_ATTACHMENT_CHARS = 2_400_000;

export function pruneAttachments(
  groups: AttachmentGroup[],
  maxChars: number = MAX_ATTACHMENT_CHARS,
): AttachmentGroup[] {
  const kept: AttachmentGroup[] = [];
  let total = 0;
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const size = groups[i].images.reduce((sum, image) => sum + image.length, 0);
    if (total + size > maxChars && kept.length > 0) break;
    total += size;
    kept.unshift(groups[i]);
  }
  return kept;
}

/**
 * 送った画像の控えをカルテに残す。
 * 控えが無い（縮小に失敗した等）時は何もしない。跡だけが残り、枚数は履歴から読める。
 */
export function rememberAttachments(
  profile: RunnerProfile,
  groupId: string | undefined,
  thumbnails: string[],
  now: Date = new Date(),
): RunnerProfile {
  if (!groupId || thumbnails.length === 0) return profile;
  return {
    ...profile,
    attachments: pruneAttachments([
      ...(profile.attachments ?? []),
      { id: groupId, images: thumbnails, createdAt: now.toISOString() },
    ]),
  };
}

function emptyState(userId: string): CoachState {
  return { profile: createDefaultProfile(userId), history: [] };
}

/** 書き込みが同時に走ってもファイルが壊れないよう、ユーザー単位で直列化する。 */
const locks = new Map<string, Promise<unknown>>();

function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  locks.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

class FileCoachStore implements CoachStore {
  private readonly dir: string;
  /** ファイルシステムが読み取り専用（サーバーレス等）な場合のフォールバック。 */
  private readonly memory = new Map<string, CoachState>();
  private fsUsable = true;

  constructor(dir: string) {
    this.dir = dir;
  }

  private file(userId: string): string {
    // userId は自分で発行した UUID のみを想定しているが、念のためパスを閉じ込める。
    const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '');
    return path.join(this.dir, `${safe || 'anonymous'}.json`);
  }

  async load(userId: string): Promise<CoachState> {
    const cached = this.memory.get(userId);
    if (cached) return cached;
    if (!this.fsUsable) return emptyState(userId);

    try {
      const raw = await fs.readFile(this.file(userId), 'utf8');
      const parsed = JSON.parse(raw) as CoachState;
      const state: CoachState = {
        profile: { ...createDefaultProfile(userId), ...parsed.profile, id: userId },
        history: parsed.history ?? [],
      };
      this.memory.set(userId, state);
      return state;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code && code !== 'ENOENT') this.fsUsable = false;
      return emptyState(userId);
    }
  }

  async save(userId: string, state: CoachState): Promise<void> {
    this.memory.set(userId, state);
    if (!this.fsUsable) return;
    await withLock(userId, async () => {
      try {
        await fs.mkdir(this.dir, { recursive: true });
        const target = this.file(userId);
        const tmp = `${target}.${process.pid}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
        await fs.rename(tmp, target);
      } catch {
        // 書けない環境ではメモリ保持に切り替える。会話は続けられる。
        this.fsUsable = false;
      }
    });
  }

  async listProfiles(limit = 500): Promise<{ userId: string; profile: RunnerProfile }[]> {
    const found = new Map<string, RunnerProfile>();
    for (const [userId, state] of this.memory) found.set(userId, state.profile);

    if (this.fsUsable) {
      try {
        const files = await fs.readdir(this.dir);
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          const userId = file.replace(/\.json$/, '');
          if (found.has(userId)) continue;
          try {
            const parsed = JSON.parse(await fs.readFile(path.join(this.dir, file), 'utf8')) as CoachState;
            // 保存が古くて足りない項目を、既定値で埋める。load と同じ扱いにする。
            if (parsed.profile) {
              found.set(userId, { ...createDefaultProfile(userId), ...parsed.profile, id: userId });
            }
          } catch {
            // 壊れているファイルは飛ばす。ほかの人の通知まで止めない。
          }
        }
      } catch {
        // 読めない環境ではメモリ上の分だけを返す。
      }
    }

    return [...found].slice(0, limit).map(([userId, profile]) => ({ userId, profile }));
  }

  async saveProfile(userId: string, profile: RunnerProfile): Promise<void> {
    const state = await this.load(userId);
    await this.save(userId, { ...state, profile });
  }

  async reset(userId: string): Promise<void> {
    this.memory.delete(userId);
    if (!this.fsUsable) return;
    await withLock(userId, async () => {
      await fs.rm(this.file(userId), { force: true }).catch(() => undefined);
    });
  }

  async adopt(fromUserId: string, toUserId: string): Promise<boolean> {
    if (fromUserId === toUserId) return false;

    const target = await this.load(toUserId);
    // すでに会話が始まっているアカウントには、匿名の記録を被せない。
    if (target.history.length > 0) return false;

    const source = await this.load(fromUserId);
    if (source.history.length === 0) return false;

    await this.save(toUserId, { profile: { ...source.profile, id: toUserId }, history: source.history });
    await this.reset(fromUserId);
    return true;
  }
}

let store: CoachStore | null = null;

function dataDir(): string {
  const configured = process.env.COACH_DATA_DIR;
  if (configured) {
    if (path.isAbsolute(configured)) return configured;
    // 設定値は実行時にしか決まらないので、ビルド時のファイル追跡からは外す。
    return path.join(/* turbopackIgnore: true */ process.cwd(), configured);
  }
  // Vercel などサーバーレス環境では、アプリのディレクトリは読み取り専用。
  // 書ける場所は /tmp だけなので、そこを既定にする（インスタンスが入れ替わると消える）。
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join(os.tmpdir(), 'legendary-running-coach');
  }
  return path.join(process.cwd(), '.data');
}

export function getStore(): CoachStore {
  if (store) return store;

  // Supabase が設定されていればそちらへ。設定が無ければファイル保存のまま動かす。
  // 「まだデータベースを用意していないと何も動かない」という状態を作らないため。
  const client = createSupabaseAdminClient();
  store = client ? new SupabaseCoachStore(client) : new FileCoachStore(dataDir());
  return store;
}

/**
 * セッションに対応する状態を読む。
 * ログイン直後で、未ログイン時の記録が残っていれば、ここで引き継ぐ。
 */
export async function loadForSession(session: {
  userId: string;
  anonymousId?: string;
  authUserId?: string;
}): Promise<CoachState> {
  const current = getStore();

  if (session.authUserId && session.anonymousId && session.anonymousId !== session.userId) {
    try {
      await current.adopt(session.anonymousId, session.userId, session.authUserId);
    } catch (error) {
      // 引き継ぎに失敗しても、対話そのものは続けられた方がよい。
      console.error('[coach] 匿名データの引き継ぎに失敗', error);
    }
  }

  return current.load(session.userId);
}

/** テスト用。 */
export function setStore(custom: CoachStore | null): void {
  store = custom;
}

export type { RunnerProfile };
