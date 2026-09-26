-- Keep the research CSV unchanged in a private staging table.
create table public.seichi_research_import (
  "レコードID" text primary key,
  "作品ID" text not null,
  "地点ID" text not null,
  "作品名" text not null,
  "分類" text,
  "作品版" text,
  "地点名" text not null,
  "都道府県" text,
  "市区町村等" text,
  "地点粒度" text,
  "作品との関係" text,
  "根拠概要" text,
  "出典名" text,
  "出典URL" text,
  "出典確認段階" text,
  "資料確認期間" text,
  "緯度" text,
  "経度" text,
  "座標確認状態" text,
  "現在の訪問可否" text,
  "ルート利用判定" text,
  "注意事項" text
);
alter table public.seichi_research_import enable row level security;
revoke all on public.seichi_research_import from anon, authenticated;

-- Only vetted catalog fields are exposed to the public search interface.
create table public.research_works (
  id text primary key,
  title text not null,
  category text,
  version text,
  regions text[] not null default '{}',
  spot_count integer not null default 0,
  search_text text not null default ''
);
alter table public.research_works enable row level security;
create policy "Public can read research works" on public.research_works
  for select to anon, authenticated using (true);
grant select on public.research_works to anon, authenticated;
