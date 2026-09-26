-- Enrich only independently checked places; the raw CSV remains private.
alter table public.verified_seichi_spots
  add column coordinate_source_url text,
  add column access_note text not null default '',
  add column stay_minutes integer not null default 20 check (stay_minutes between 5 and 180),
  add column closed_weekdays smallint[] not null default '{}',
  add column closed_last_friday boolean not null default false;

-- A leg is published only when its travel time has a cited source.
create table public.verified_travel_legs (
  from_spot_id text not null references public.verified_seichi_spots(id),
  to_spot_id text not null references public.verified_seichi_spots(id),
  mode text not null check (mode in ('walking', 'transit')),
  minutes integer not null check (minutes between 1 and 600),
  source_url text not null,
  verified_at timestamptz not null,
  primary key (from_spot_id, to_spot_id),
  check (from_spot_id <> to_spot_id)
);
create index verified_travel_legs_to_idx on public.verified_travel_legs (to_spot_id);
alter table public.verified_travel_legs enable row level security;
create policy "Public can read verified travel legs"
  on public.verified_travel_legs for select to anon, authenticated using (true);
grant select on public.verified_travel_legs to anon, authenticated;
