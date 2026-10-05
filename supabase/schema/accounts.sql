-- ============================================================
-- MeterSahi? — user accounts, trip history and complaints
-- Run once in the Supabase SQL editor (Dashboard → SQL → New query).
-- Safe to re-run: every statement is guarded.
--
-- What this adds:
--   profiles           one row per signed-up user
--   user_id columns    on fare_calculations and vehicle_reports
--   RLS policies       anonymous INSERT stays exactly as before;
--                      signed-in users can read back only their own rows
--
-- Existing anonymous rows are left untouched (user_id stays NULL) and
-- are never visible to any account — history starts at sign-up.
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. PROFILES
-- ─────────────────────────────────────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "profiles: insert own" on public.profiles;
create policy "profiles: insert own"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Create the profile row automatically on sign-up. Google and Facebook
-- supply name/avatar in raw_user_meta_data; email sign-ups usually don't,
-- so fall back to the local part of the email address.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    coalesce(
      new.raw_user_meta_data->>'avatar_url',
      new.raw_user_meta_data->>'picture'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────
-- 2. OWNERSHIP COLUMNS
--    Nullable on purpose: anonymous use must keep working untouched.
--    on delete cascade is what makes account deletion remove the
--    user's data without a second cleanup pass.
-- ─────────────────────────────────────────────
alter table public.fare_calculations
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.vehicle_reports
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists fare_calculations_user_id_idx
  on public.fare_calculations (user_id, created_at desc);

create index if not exists vehicle_reports_user_id_idx
  on public.vehicle_reports (user_id, created_at desc);

-- ─────────────────────────────────────────────
-- 3. RLS
--    INSERT: anon may insert only rows with user_id IS NULL (unchanged
--    behaviour for logged-out visitors). Authenticated users may insert
--    only rows stamped with their own uid — they cannot write rows into
--    someone else's history.
--    SELECT: own rows only. There is deliberately no public SELECT, so
--    the anon key still cannot read the tables.
-- ─────────────────────────────────────────────
alter table public.fare_calculations enable row level security;
alter table public.vehicle_reports  enable row level security;

drop policy if exists "fare_calculations: anon insert" on public.fare_calculations;
create policy "fare_calculations: anon insert"
  on public.fare_calculations for insert
  to anon
  with check (user_id is null);

drop policy if exists "fare_calculations: insert own" on public.fare_calculations;
create policy "fare_calculations: insert own"
  on public.fare_calculations for insert
  to authenticated
  with check (user_id is null or user_id = auth.uid());

drop policy if exists "fare_calculations: read own" on public.fare_calculations;
create policy "fare_calculations: read own"
  on public.fare_calculations for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "vehicle_reports: anon insert" on public.vehicle_reports;
create policy "vehicle_reports: anon insert"
  on public.vehicle_reports for insert
  to anon
  with check (user_id is null);

drop policy if exists "vehicle_reports: insert own" on public.vehicle_reports;
create policy "vehicle_reports: insert own"
  on public.vehicle_reports for insert
  to authenticated
  with check (user_id is null or user_id = auth.uid());

drop policy if exists "vehicle_reports: read own" on public.vehicle_reports;
create policy "vehicle_reports: read own"
  on public.vehicle_reports for select
  to authenticated
  using (user_id = auth.uid());

-- ─────────────────────────────────────────────
-- 4. DASHBOARD SUMMARY
--    One round trip instead of three counts. security invoker means it
--    runs under the caller's RLS, so it can only ever see their rows.
-- ─────────────────────────────────────────────
create or replace view public.my_activity_summary
with (security_invoker = on)
as
select
  auth.uid()                                              as user_id,
  (select count(*) from public.fare_calculations f
     where f.user_id = auth.uid())                        as trips_calculated,
  (select count(*) from public.fare_calculations f
     where f.user_id = auth.uid() and f.succeeded)        as trips_succeeded,
  (select count(*) from public.vehicle_reports r
     where r.user_id = auth.uid())                        as reports_raised,
  (select count(distinct f.city_slug) from public.fare_calculations f
     where f.user_id = auth.uid())                        as cities_used;

grant select on public.my_activity_summary to authenticated;
