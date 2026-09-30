/**
 * 何がそろっていて、何が足りないか。
 *
 * **環境変数が増えすぎて、持ち主が把握できなくなった。**
 * 入れたつもりで入っていない、リデプロイを忘れた、名前を間違えた——
 * どれも起こるのに、起きたことに気づく手立てが無かった。
 * 一つひとつ画面で確かめるのではなく、**アプリ自身に答えさせる。**
 *
 * 値そのものは絶対に返さない。返すのは名前と、入っているかどうかだけ。
 */

import { cleanEnv } from './env';

export interface FeatureStatus {
  /** 何のための設定か（日本語）。 */
  label: string;
  /** 使える状態か。 */
  ready: boolean;
  /** 足りない環境変数の名前。**値は入れない。** */
  missing: string[];
  /** 無くてもアプリは動くか。 */
  optional: boolean;
}

const has = (env: NodeJS.ProcessEnv, name: string) => cleanEnv(env[name]).length > 0;

/** どれか1つあればよい組み合わせ（旧名と新名など）。 */
const either = (env: NodeJS.ProcessEnv, names: string[]) => names.some((name) => has(env, name));

interface Spec {
  label: string;
  optional: boolean;
  /** すべて要るもの。 */
  all?: string[];
  /** どれか1つ要るもの（組ごと）。 */
  anyOf?: string[][];
}

const SPECS: Spec[] = [
  { label: 'コーチとの対話', optional: false, all: ['GEMINI_API_KEY'] },
  {
    label: '記録の保存とログイン',
    optional: false,
    all: ['NEXT_PUBLIC_SUPABASE_URL'],
    anyOf: [
      ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'],
      ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY'],
    ],
  },
  { label: '費用の表示（/admin）', optional: true, all: ['GEMINI_PRICE_PER_MTOK', 'ADMIN_EMAILS'] },
  { label: 'アプリの住所（楽天とStravaが使う）', optional: true, all: ['NEXT_PUBLIC_SITE_URL'] },
  {
    label: '商品の紹介と収益（楽天）',
    optional: true,
    all: ['RAKUTEN_APP_ID', 'RAKUTEN_ACCESS_KEY', 'RAKUTEN_AFFILIATE_ID'],
  },
  { label: '練習の自動取り込み（Strava）', optional: true, all: ['STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET'] },
  {
    label: '通知',
    optional: true,
    all: ['VAPID_PRIVATE_KEY', 'CRON_SECRET'],
    anyOf: [['VAPID_PUBLIC_KEY', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY']],
  },
  {
    label: '規約と運営者の表示',
    optional: false,
    all: ['LEGAL_OPERATOR_NAME', 'LEGAL_CONTACT_EMAIL'],
  },
  {
    label: '有料プラン（Stripe）',
    optional: true,
    all: ['STRIPE_SECRET_KEY', 'STRIPE_PRICE_ID', 'STRIPE_WEBHOOK_SECRET'],
  },
  {
    label: '特定商取引法に基づく表記（有料にするなら必須）',
    optional: true,
    all: ['LEGAL_ADDRESS', 'LEGAL_PRICE_TEXT'],
  },
];

export function setupStatus(env: NodeJS.ProcessEnv = process.env): FeatureStatus[] {
  return SPECS.map((spec) => {
    const missing = [
      ...(spec.all ?? []).filter((name) => !has(env, name)),
      // どれか1つでよい組は、1つも無い時だけ「足りない」として名前を並べる。
      ...(spec.anyOf ?? []).filter((names) => !either(env, names)).map((names) => names.join(' または ')),
    ];
    return { label: spec.label, ready: missing.length === 0, missing, optional: spec.optional };
  });
}

/** まだ足りないものだけ。そろっていれば空。 */
export function pendingSetup(env: NodeJS.ProcessEnv = process.env): FeatureStatus[] {
  return setupStatus(env).filter((status) => !status.ready);
}

/**
 * 人に配れる状態か。
 *
 * **「pending が空か」では判断できない。** Strava も Stripe も特商法も
 * 無くてよいものなので、pending は当分ずっと空にならない。
 * それを見て「まだ何か足りない」と読むか、逆に並んでいるのを見慣れて
 * **本当に足りないものを見落とすか**、どちらかになる。
 *
 * 無くては困るものだけを見て、ひとことで答える。
 */
export function readyToShare(env: NodeJS.ProcessEnv = process.env): boolean {
  return setupStatus(env).every((status) => status.optional || status.ready);
}

/** 無くては困るのに足りないもの。**ここが空でなければ、人に配れない。** */
export function blockingSetup(env: NodeJS.ProcessEnv = process.env): FeatureStatus[] {
  return pendingSetup(env).filter((status) => !status.optional);
}
