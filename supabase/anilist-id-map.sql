-- Verified against AniList title, format and edition on 2026-09-26.
-- Ambiguous series (Free! Timeless Medley, Natsume Yuujinchou) are intentionally unmapped.
update public.research_works as work
set anilist_id = matches.anilist_id
from (values
  ('w_bdee7837dcb857', 101610),
  ('w_b620bd6dfb2b3f', 1029),
  ('w_19a5085e2bf441', 1689),
  ('w_b0b4f44d5a0d4e', 99426),
  ('w_57c71c259d1a53', 1887),
  ('w_e1a48272cf20fe', 585),
  ('w_6bc11183b70829', 12355),
  ('w_395a92281c2f9a', 9289),
  ('w_2332ba4a9956a9', 98444),
  ('w_260ac5bdef91d7', 5681),
  ('w_34615c1734a950', 12189),
  ('w_acbf524039d3e2', 21519),
  ('w_f52cc2944adca3', 104459),
  ('w_f195b04b0427da', 171457),
  ('w_fb41b868e0f278', 5680),
  ('w_5e5c5d8896363f', 183384),
  ('w_ddeeef2d11934b', 129201),
  ('w_fca3c0ec7c5c9e', 115113),
  ('w_187519a9729659', 21158),
  ('w_549e5dcc5507e8', 5084),
  ('w_3b3cdaf9bff7ce', 127271),
  ('w_cde70fdf82d150', 21709),
  ('w_6305e34a073c04', 101316)
) as matches(work_id, anilist_id)
where work.id = matches.work_id;
