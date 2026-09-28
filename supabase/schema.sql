-- RUNCOACH / Supabase スキーマ
--
-- Supabase の SQL Editor にこのファイルの中身を貼り付けて実行してください。
-- 何度実行しても壊れないように書いてあります（IF NOT EXISTS / CREATE OR REPLACE）。

-- ============================================================
-- 1. コーチの状態（カルテ・会話履歴・毎日の記録）
-- ============================================================
--
-- profile と history は、アプリ内のデータ構造をそのまま JSONB で保存します。
-- 体重・連続ログイン・スタンプは profile.dailyLog の中に入ります。
--
-- 正規化せず JSONB にしているのは、アプリの型定義を唯一の真実に保つためです。
-- 将来、分析や集計のためにテーブルを分ける場合は、
-- この JSONB を元にビューやマテリアライズドビューを作るところから始められます。

create table if not exists public.coach_states (
  -- ログイン済みなら auth.users.id、未ログインなら端末ごとの匿名ID。
  user_id text primary key,
  -- ログイン済みユーザーの場合のみ、auth.users への参照を持つ。
  auth_user_id uuid references auth.users (id) on delete cascade,
  profile jsonb not null default '{}'::jsonb,
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ログインユーザーの行をすぐ引けるように。
create index if not exists coach_states_auth_user_id_idx
  on public.coach_states (auth_user_id);

-- 最終更新の新しい順に並べる用途（管理・分析）。
create index if not exists coach_states_updated_at_idx
  on public.coach_states (updated_at desc);

-- ============================================================
-- 2. updated_at の自動更新
-- ============================================================

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists coach_states_touch_updated_at on public.coach_states;
create trigger coach_states_touch_updated_at
  before update on public.coach_states
  for each row
  execute function public.touch_updated_at();

-- ============================================================
-- 3. 行レベルセキュリティ
-- ============================================================
--
-- アプリのサーバー側は service_role キーで接続するため RLS を迂回します。
-- それでも RLS を有効にしておくのは、万一 anon キーが表に出た時に
-- 他人のカルテが読めてしまう事故を防ぐためです（多層防御）。

alter table public.coach_states enable row level security;

drop policy if exists "自分の行だけ読める" on public.coach_states;
create policy "自分の行だけ読める"
  on public.coach_states
  for select
  using (auth.uid() = auth_user_id);

drop policy if exists "自分の行だけ作れる" on public.coach_states;
create policy "自分の行だけ作れる"
  on public.coach_states
  for insert
  with check (auth.uid() = auth_user_id);

drop policy if exists "自分の行だけ更新できる" on public.coach_states;
create policy "自分の行だけ更新できる"
  on public.coach_states
  for update
  using (auth.uid() = auth_user_id)
  with check (auth.uid() = auth_user_id);

drop policy if exists "自分の行だけ消せる" on public.coach_states;
create policy "自分の行だけ消せる"
  on public.coach_states
  for delete
  using (auth.uid() = auth_user_id);

-- ============================================================
-- 4. 使った回数（1日の上限と、費用の実測）
-- ============================================================
--
-- 1日に話せる回数を数えるための表です（src/lib/quota.ts）。
-- key に日付が入っているので、日が変わると自然に別の数になります。
--   turns:2026-09-28:user:<id>    その人が今日話した回数
--   turns:2026-09-28:place:<hash> 同じ回線から今日話した回数（IP は潰して保存。元には戻せません）
--   turns:2026-09-28:all          アプリ全体で今日話した回数
--   tokens-in / tokens-out / calls / users   費用を出すための実測
--
-- **利用者の側（anon キー）からは、一切触れないようにしてあります。**
-- 触れると、他人の回数を使い切らせたり、全体の上限まで埋めて止めたりできてしまうため。

create table if not exists public.usage_counters (
  key text primary key,
  count bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- 行レベルセキュリティを有効にし、ポリシーは作らない。
-- = service_role（アプリのサーバー）以外は、読むことも書くこともできない。
alter table public.usage_counters enable row level security;

-- 足して、足した後の値を返す。**1本の文でやるので、同時に来ても数え漏れない。**
create or replace function public.bump_usage(p_key text, p_by bigint default 1)
returns bigint
language sql
as $$
  insert into public.usage_counters as u (key, count)
  values (p_key, p_by)
  on conflict (key) do update
    set count = u.count + excluded.count,
        updated_at = now()
  returning u.count;
$$;

-- 関数は、作った時点で誰でも呼べる状態になっている。サーバーだけに絞る。
revoke all on function public.bump_usage(text, bigint) from public, anon, authenticated;
grant execute on function public.bump_usage(text, bigint) to service_role;

-- ============================================================
-- 5. 運営の記録（不具合と、返答への評価）
-- ============================================================
--
-- 持ち主だけが /admin で読みます（src/lib/ops.ts）。
--   kind = 'error'     本番で起きた不具合。どこで・何が・どのビルドで
--   kind = 'feedback'  返答への「良い・良くない」と、その理由
--
-- 使った回数や、使い始めた人数などの数は、4. の usage_counters に入ります。
-- **利用者の側（anon キー）からは、一切触れないようにしてあります。**

create table if not exists public.app_events (
  id bigint generated always as identity primary key,
  kind text not null,
  user_id text,
  -- 同じものを2件にしないための目印。評価なら「誰が・どの返答に」。
  -- 良い→良くないと押し直したり、あとから理由を足したりしても、1件のまま書き換わる。
  -- 空の行（不具合など）はいくつあってもよい（NULL どうしは重複とみなされない）。
  ref text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (kind, ref)
);

create index if not exists app_events_kind_created_at_idx
  on public.app_events (kind, created_at desc);

-- 行レベルセキュリティを有効にし、ポリシーは作らない。= サーバーだけが読み書きできる。
alter table public.app_events enable row level security;
