-- ============================================================
-- CourseCue — Full Schema
-- ============================================================
--
-- Migration: Add notification preferences (Session 16)
-- Run in Supabase SQL Editor:
--   ALTER TABLE public.profiles
--     ADD COLUMN quiet_hours_start smallint check (quiet_hours_start between 0 and 23),
--     ADD COLUMN quiet_hours_end smallint check (quiet_hours_end between 0 and 23),
--     ADD COLUMN nudge_frequency text not null default 'normal' check (nudge_frequency in ('aggressive','normal','minimal')),
--     ADD COLUMN stress_threshold smallint not null default 5 check (stress_threshold between 1 and 20),
--     ADD COLUMN nudge_paused_until timestamptz;

-- Enable pgcrypto for gen_random_uuid()
create extension if not exists "pgcrypto";

-- ============================================================
-- TABLE: profiles
-- ============================================================
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  canvas_domain text,
  canvas_token  text,
  timezone      text default 'America/Chicago'
    constraint profiles_timezone_shape
    check (timezone is null or timezone ~ '^[A-Za-z][A-Za-z0-9_+\-/]{1,63}$'),
  onboarding_complete boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  quiet_hours_start   smallint check (quiet_hours_start between 0 and 23),
  quiet_hours_end     smallint check (quiet_hours_end between 0 and 23),
  nudge_frequency     text not null default 'normal' check (nudge_frequency in ('aggressive','normal','minimal')),
  stress_threshold    smallint not null default 5 check (stress_threshold between 1 and 20),
  nudge_paused_until  timestamptz,
  -- Last successful Canvas sync (manual, auto, or scheduled). Set by
  -- syncUserCanvas; shown in the UI as "Last sync". updated_at is NOT this —
  -- it tracks settings edits.
  last_synced_at      timestamptz
);

alter table public.profiles enable row level security;

create policy "profiles: owner select"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: owner insert"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles: owner update"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "profiles: owner delete"
  on public.profiles for delete
  using (auth.uid() = id);

-- ============================================================
-- TABLE: courses
-- ============================================================
create table if not exists public.courses (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  canvas_course_id bigint not null,
  name             text not null,
  color            text not null default '#6366f1',
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, canvas_course_id)
);

alter table public.courses enable row level security;

create policy "courses: owner select"
  on public.courses for select
  using (auth.uid() = user_id);

create policy "courses: owner insert"
  on public.courses for insert
  with check (auth.uid() = user_id);

create policy "courses: owner update"
  on public.courses for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "courses: owner delete"
  on public.courses for delete
  using (auth.uid() = user_id);

-- ============================================================
-- TABLE: assignments
-- ============================================================
create table if not exists public.assignments (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  course_id            uuid not null references public.courses(id) on delete cascade,
  canvas_assignment_id bigint not null,
  title                text not null,
  due_at               timestamptz,
  points_possible      numeric,
  submission_types     text[] not null default '{}',
  html_url             text,
  estimated_minutes    int,
  priority             smallint not null default 2 check (priority between 1 and 3),
  is_completed         boolean not null default false,
  dismissed_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (user_id, canvas_assignment_id)
);

create index if not exists assignments_user_active_due
  on public.assignments (user_id, is_completed, due_at)
  where due_at is not null and dismissed_at is null;

alter table public.assignments enable row level security;

create policy "assignments: owner select"
  on public.assignments for select
  using (auth.uid() = user_id);

create policy "assignments: owner insert"
  on public.assignments for insert
  with check (auth.uid() = user_id);

create policy "assignments: owner update"
  on public.assignments for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "assignments: owner delete"
  on public.assignments for delete
  using (auth.uid() = user_id);

-- ============================================================
-- TABLE: push_subscriptions
-- ============================================================
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy "push_subscriptions: owner select"
  on public.push_subscriptions for select
  using (auth.uid() = user_id);

create policy "push_subscriptions: owner insert"
  on public.push_subscriptions for insert
  with check (auth.uid() = user_id);

create policy "push_subscriptions: owner update"
  on public.push_subscriptions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "push_subscriptions: owner delete"
  on public.push_subscriptions for delete
  using (auth.uid() = user_id);

-- ============================================================
-- TABLE: productive_windows
-- ============================================================
create table if not exists public.productive_windows (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  day_of_week  smallint not null check (day_of_week between 0 and 6), -- 0=Sun, 6=Sat
  hour_of_day  smallint not null check (hour_of_day between 0 and 23),
  score        numeric(4,3) not null default 0 check (score between 0 and 1), -- max 1.000, 3 decimal places — safe at current threshold range (0.02–0.07)
  updated_at   timestamptz not null default now(),
  unique (user_id, day_of_week, hour_of_day)
);

alter table public.productive_windows enable row level security;

create policy "productive_windows: owner select"
  on public.productive_windows for select
  using (auth.uid() = user_id);

create policy "productive_windows: owner insert"
  on public.productive_windows for insert
  with check (auth.uid() = user_id);

create policy "productive_windows: owner update"
  on public.productive_windows for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "productive_windows: owner delete"
  on public.productive_windows for delete
  using (auth.uid() = user_id);

-- ============================================================
-- TABLE: nudge_logs
-- Deduplication log for sent push notifications
-- ============================================================
create table if not exists public.nudge_logs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  assignment_id  uuid references public.assignments(id) on delete cascade,
  nudge_type     text not null check (nudge_type in ('productive_window', '12h', '6h', '1h', 'overdue', 'token_expired')),
  sent_at        timestamptz not null default now()
);

-- Unique index: each assignment can only receive each nudge type once.
-- Non-partial (unlike a `where assignment_id is not null` variant): partial
-- unique indexes cannot be inferred by PostgREST upsert ON CONFLICT targets
-- (error 42P10). NULL assignment_id rows (productive_window) stay unrestricted
-- since Postgres treats NULLs as distinct. Applied to prod 2026-08-23.
create unique index if not exists nudge_logs_dedup
  on public.nudge_logs (user_id, assignment_id, nudge_type);

create index if not exists nudge_logs_user_type_time
  on public.nudge_logs (user_id, nudge_type, sent_at desc);

alter table public.nudge_logs enable row level security;

create policy "nudge_logs: owner select"
  on public.nudge_logs for select
  using (auth.uid() = user_id);

create policy "nudge_logs: owner insert"
  on public.nudge_logs for insert
  with check (auth.uid() = user_id);

create policy "nudge_logs: owner update"
  on public.nudge_logs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "nudge_logs: owner delete"
  on public.nudge_logs for delete
  using (auth.uid() = user_id);

-- ============================================================
-- TABLE: nudge_events
-- Append-only per-send history (Insights "Nudge Summary" reads this;
-- nudge_logs above is only a dedup/claim table, NOT a send log)
-- ============================================================
create table if not exists public.nudge_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  nudge_type  text not null check (nudge_type in ('productive_window', '12h', '6h', '1h', 'overdue', 'token_expired')),
  sent_at     timestamptz not null default now()
);

create index if not exists nudge_events_user_time
  on public.nudge_events (user_id, sent_at desc);

alter table public.nudge_events enable row level security;

-- Owner reads only; writes are service-role (RLS-bypassed).
create policy "nudge_events: owner select"
  on public.nudge_events for select
  using (auth.uid() = user_id);
