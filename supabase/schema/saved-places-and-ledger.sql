-- ============================================================
-- MeterSahi? — saved places + overcharge ledger
-- Run once in the Supabase SQL editor (Dashboard → SQL → New query),
-- AFTER accounts.sql. Safe to re-run: every statement is guarded.
--
-- What this adds:
--   saved_places          Home / Work / named favourites per user
--   my_overcharge_ledger  one-row rollup of what this user has been
--                         overcharged, and what they have checked
--
-- Nothing here touches anonymous use. Logged-out visitors never read or
-- write either object — there is deliberately no policy granting `anon`
-- anything, so the publishable key cannot see a single row.
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. SAVED PLACES
--
--    place_id/lat/lng are stored alongside the address text on purpose.
--    The Routes API accepts a waypoint as a place id, a coordinate pair
--    or free text, in that order of precision (see routeWaypoint() in
--    app.js). Saving only the text would mean re-geocoding it on every
--    trip and risking a different point — and therefore a different
--    distance — from the one the user actually picked.
-- ─────────────────────────────────────────────
create table if not exists public.saved_places (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('home', 'work', 'other')),
  label       text not null check (length(trim(label)) between 1 and 40),
  address     text not null check (length(trim(address)) between 1 and 300),
  place_id    text,
  lat         double precision check (lat is null or lat between -90 and 90),
  lng         double precision check (lng is null or lng between -180 and 180),
  city_slug   text,
  created_at  timestamptz not null default now()
);

alter table public.saved_places enable row level security;

-- At most one Home and one Work each; 'other' favourites are unlimited.
-- Partial unique indexes rather than a CHECK, so the constraint is
-- enforced by the database and not by whichever client wrote last.
create unique index if not exists saved_places_one_home_per_user
  on public.saved_places (user_id) where kind = 'home';

create unique index if not exists saved_places_one_work_per_user
  on public.saved_places (user_id) where kind = 'work';

create index if not exists saved_places_user_idx
  on public.saved_places (user_id, kind, created_at desc);

-- Own rows only, on all four verbs. No `anon` policy at all.
drop policy if exists "saved_places: read own" on public.saved_places;
create policy "saved_places: read own"
  on public.saved_places for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "saved_places: insert own" on public.saved_places;
create policy "saved_places: insert own"
  on public.saved_places for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "saved_places: update own" on public.saved_places;
create policy "saved_places: update own"
  on public.saved_places for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "saved_places: delete own" on public.saved_places;
create policy "saved_places: delete own"
  on public.saved_places for delete
  to authenticated
  using (user_id = auth.uid());

-- ─────────────────────────────────────────────
-- 2. OVERCHARGE LEDGER
--
--    The headline number on the dashboard: how much this user has been
--    overcharged, totalled across the vehicles they reported.
--
--    security_invoker means the view runs under the caller's RLS, so it
--    can only ever aggregate their own rows — the same approach as
--    my_activity_summary in accounts.sql.
--
--    greatest(...,0) keeps a trip where the driver charged LESS than the
--    correct fare from quietly cancelling out a real overcharge. Those
--    rows are counted separately as fair_count instead.
-- ─────────────────────────────────────────────
create or replace view public.my_overcharge_ledger
with (security_invoker = on)
as
with mine as (
  select
    r.calculated_fare,
    r.actual_fare_charged,
    case
      when r.actual_fare_charged is null or r.calculated_fare is null then null
      else r.actual_fare_charged - r.calculated_fare
    end as delta
  from public.vehicle_reports r
  where r.user_id = auth.uid()
)
select
  auth.uid()                                                      as user_id,
  coalesce(sum(greatest(delta, 0)), 0)::numeric                   as overcharge_total,
  count(*) filter (where delta > 0)                               as overcharge_count,
  coalesce(max(delta), 0)::numeric                                as worst_overcharge,
  count(*) filter (where delta is not null and delta <= 0)        as fair_count,
  count(*)                                                        as reports_total,
  -- Average only over the trips that actually were overcharged;
  -- averaging in the fair ones would understate what a bad trip costs.
  coalesce(avg(delta) filter (where delta > 0), 0)::numeric       as avg_overcharge
from mine;

grant select on public.my_overcharge_ledger to authenticated;

-- ─────────────────────────────────────────────
-- 3. FARE SPEND
--    Separate from the ledger above because it comes from a different
--    table (every Calculate press, not just the reported ones) and is
--    the denominator the overcharge total is read against.
-- ─────────────────────────────────────────────
create or replace view public.my_fare_spend
with (security_invoker = on)
as
select
  auth.uid()                                                      as user_id,
  coalesce(sum(f.calculated_fare), 0)::numeric                    as fare_total,
  count(*)                                                        as trips_total,
  coalesce(sum(f.distance_km), 0)::numeric                        as distance_total,
  max(f.created_at)                                               as last_trip_at
from public.fare_calculations f
where f.user_id = auth.uid()
  and f.succeeded;

grant select on public.my_fare_spend to authenticated;
