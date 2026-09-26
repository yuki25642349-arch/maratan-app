-- Run after importing the CSV into public.seichi_research_import.
insert into public.research_works (id, title, category, version, regions, spot_count, search_text)
select
  "作品ID",
  min("作品名"),
  min("分類"),
  min("作品版"),
  array_agg(distinct concat_ws('・', nullif("都道府県", ''), nullif("市区町村等", ''))
    order by concat_ws('・', nullif("都道府県", ''), nullif("市区町村等", ''))),
  count(*)::integer,
  min("作品名") || ' ' || string_agg(distinct concat_ws(' ', "都道府県", "市区町村等"), ' ')
from public.seichi_research_import
group by "作品ID"
on conflict (id) do update set
  title = excluded.title,
  category = excluded.category,
  version = excluded.version,
  regions = excluded.regions,
  spot_count = excluded.spot_count,
  search_text = excluded.search_text;
