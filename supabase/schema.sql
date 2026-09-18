-- 伝説のランニングコーチ / Supabase スキーマ
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
