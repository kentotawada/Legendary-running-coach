import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CoachState, RunnerProfile } from './types';
import { createEmptyProfile } from './types';
import type { Content } from '@google/genai';

/**
 * 保存層。いまは JSON ファイルだが、
 * iOS / Android から同じ API を叩く時に DB へ差し替えられるよう、
 * インタフェースだけ切っておく。
 */
export interface CoachStore {
  load(userId: string): Promise<CoachState>;
  save(userId: string, state: CoachState): Promise<void>;
  reset(userId: string): Promise<void>;
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

function emptyState(userId: string): CoachState {
  return { profile: createEmptyProfile(userId), history: [] };
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
        profile: { ...createEmptyProfile(userId), ...parsed.profile, id: userId },
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

  async reset(userId: string): Promise<void> {
    this.memory.delete(userId);
    if (!this.fsUsable) return;
    await withLock(userId, async () => {
      await fs.rm(this.file(userId), { force: true }).catch(() => undefined);
    });
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
  if (!store) store = new FileCoachStore(dataDir());
  return store;
}

/** テスト用。 */
export function setStore(custom: CoachStore | null): void {
  store = custom;
}

export type { RunnerProfile };
