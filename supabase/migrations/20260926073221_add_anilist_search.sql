-- AniList IDs are assigned only after comparing the series and its edition.
alter table public.research_works
  add column anilist_id integer check (anilist_id > 0);
create unique index research_works_anilist_id_key
  on public.research_works (anilist_id)
  where anilist_id is not null;

-- A row exists here only after its coordinates and visit conditions are checked.
-- Imported research rows are never promoted automatically.
create table public.verified_seichi_spots (
  id text primary key,
  work_id text not null references public.research_works(id),
  name text not null,
  region text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  source_url text not null,
  visit_confirmed_at timestamptz not null,
  notes text
);
create index verified_seichi_spots_work_region_idx
  on public.verified_seichi_spots (work_id, region);
alter table public.verified_seichi_spots enable row level security;
create policy "Public can read verified seichi spots"
  on public.verified_seichi_spots for select to anon, authenticated
  using (true);
grant select on public.verified_seichi_spots to anon, authenticated;
