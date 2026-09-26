-- Only verified records are public. Existing verified rows remain published.
alter table public.verified_seichi_spots
  add column published boolean not null default true,
  add column relationship_note text,
  add column entrance_note text,
  add column official_url text,
  add column source_checked_at date,
  add column hours_status text not null default 'unknown'
    check (hours_status in ('unknown', 'no_hours', 'hours_known')),
  add column opening_hours jsonb,
  add column last_admission text,
  add column reservation_status text not null default 'unknown'
    check (reservation_status in ('unknown', 'required', 'not_required')),
  add column admission_yen integer check (admission_yen >= 0),
  add column exceptional_closed_dates date[] not null default '{}';

drop policy if exists "Public can read verified seichi spots" on public.verified_seichi_spots;
create policy "Public can read published seichi spots"
  on public.verified_seichi_spots for select to anon, authenticated using (published);
create index verified_seichi_spots_published_work_region_idx
  on public.verified_seichi_spots (work_id, region) where published;

create table public.verified_local_detours (
  id text primary key check (id ~ '^d_[a-z0-9]+$'),
  name text not null,
  region text not null,
  category text not null check (category in ('food', 'shopping', 'culture', 'experience')),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  entrance_note text,
  local_relevance text not null,
  source_url text not null,
  source_checked_at date not null,
  official_url text,
  stay_minutes integer not null default 30 check (stay_minutes between 5 and 180),
  access_note text not null default '',
  closed_weekdays smallint[] not null default '{}',
  exceptional_closed_dates date[] not null default '{}',
  hours_status text not null default 'unknown'
    check (hours_status in ('unknown', 'no_hours', 'hours_known')),
  opening_hours jsonb,
  last_admission text,
  reservation_status text not null default 'unknown'
    check (reservation_status in ('unknown', 'required', 'not_required')),
  reference_price_yen integer check (reference_price_yen >= 0),
  published boolean not null default false
);
create index verified_local_detours_published_region_idx
  on public.verified_local_detours (region) where published;
alter table public.verified_local_detours enable row level security;
create policy "Public can read published local detours"
  on public.verified_local_detours for select to anon, authenticated using (published);
revoke all on public.verified_local_detours from anon, authenticated;
grant select on public.verified_local_detours to anon, authenticated;
