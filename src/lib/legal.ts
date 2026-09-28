/**
 * 規約と同意。
 *
 * **このアプリは、痛み・故障歴・体重・心拍を預かる。**
 * 故障歴のような体の情報は、個人情報保護法の「要配慮個人情報」にあたりうるもので、
 * 預かるには本人のはっきりした同意が要る。会話の内容は、返事を作るために
 * 海外の事業者（Google）へ送っているので、その点の同意も要る。
 *
 * 同意は「いつ・どの版に」を記録する。後から中身を変えた時に、
 * 誰がどの版に同意しているのかが分からないと、同意を取った意味が無くなる。
 */

import { cleanEnv } from './build-info';
import type { RunnerProfile } from './types';

/**
 * いまの規約の版。**中身を大きく変えたら、ここを上げる。**
 * 上げると、全員にもう一度同意を求める画面が出る。
 */
export const CONSENT_VERSION = '2026-09-28';

/** 画面に出す制定日。版と同じ日付。 */
export const LEGAL_EFFECTIVE_DATE = '2026年9月28日';

export function hasConsent(profile: Pick<RunnerProfile, 'consent'> | null | undefined): boolean {
  return profile?.consent?.version === CONSENT_VERSION;
}

/** 同意を記録する。**時刻はサーバーが決める**（画面から送られた時刻は信用しない）。 */
export function withConsent<T extends RunnerProfile>(profile: T, now: Date = new Date()): T {
  return { ...profile, consent: { version: CONSENT_VERSION, at: now.toISOString() }, updatedAt: now.toISOString() };
}

/** 同意が無い時に、記録を預かる入口が返す文章。 */
export const CONSENT_REQUIRED_MESSAGE =
  '利用規約とプライバシーポリシーへの同意が必要です。画面を開き直して、同意してから続けてください。';

export interface OperatorInfo {
  /** 運営者の名前（個人名・屋号・会社名）。 */
  name: string;
  /** 問い合わせ先のメールアドレス。 */
  contact: string;
  /** 未設定の項目があるか。**公開前に必ず埋める。** */
  incomplete: boolean;
}

/**
 * 運営者の情報。Vercel の環境変数から読む。
 * コードに直接書かないのは、名前や連絡先が変わった時に、コードを触らずに差し替えるため。
 */
export function operatorInfo(env: NodeJS.ProcessEnv = process.env): OperatorInfo {
  const name = cleanEnv(env.LEGAL_OPERATOR_NAME);
  const contact = cleanEnv(env.LEGAL_CONTACT_EMAIL);
  return {
    name: name || '（運営者名：未設定）',
    contact: contact || '（連絡先：未設定）',
    incomplete: !name || !contact,
  };
}
