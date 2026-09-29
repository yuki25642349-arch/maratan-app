-- Additional published spots from the existing research catalog.
-- Discovery: https://oshiwaku.net/seichi (not used as a coordinate authority).
-- OshiWaku's Kuji Station and Kosode lighthouse pins disagreed substantially
-- with named OpenStreetMap features, so only independently checked coordinates
-- and primary tourism/municipal relationship sources are published here.
-- Broad areas, private property and uncertain entrances remain research-only.

insert into public.verified_seichi_spots (
  id, work_id, name, region, latitude, longitude,
  source_url, coordinate_source_url, visit_confirmed_at,
  relationship_note, access_note, stay_minutes, notes,
  official_url, source_checked_at, hours_status,
  reservation_status, admission_yen, published
) values
  (
    'p_0dec90da0eab9b', 'w_aea10d2ded4091', '三陸鉄道久慈駅', '岩手県・久慈市',
    40.1902704, 141.7707503,
    'https://www.city.kuji.lg.jp/kanko_bunka_sports/kanko/3/1/3680.html',
    'https://www.openstreetmap.org/way/279717564', now(),
    'ドラマでは「北三陸駅」として登場した三陸鉄道の駅。',
    '駅舎外観・駅前から見学。ホームや改札内には有効な乗車券等が必要です。運行・立入条件は現地で確認してください。',
    15,
    'ピンは駅舎の中心付近で、作品と同じ撮影視点ではありません。',
    'https://www.city.kuji.lg.jp/kanko_bunka_sports/kanko/3/1/3680.html',
    date '2026-09-26', 'no_hours', 'not_required', 0, true
  ),
  (
    'p_a56d3baeddab85', 'w_aea10d2ded4091',
    '小袖海岸・海女素潜り実演場付近', '岩手県・久慈市',
    40.1684793, 141.8524227,
    'https://www.city.kuji.lg.jp/kanko_bunka_sports/kanko/3/1/3680.html',
    'https://www.openstreetmap.org/node/3251456856', now(),
    '海女の素潜り場面が撮影された小袖地区。',
    'ピンは小袖海女センターの位置で、実演場所や撮影視点の正確な位置ではありません。港の立入規制に従ってください。実演は開催日・季節を別途確認してください。',
    25,
    '小袖海女センターを2026年の催事会場とする久慈市案内: https://www.city.kuji.lg.jp/kanko_bunka_sports/kanko/4/5594.html',
    'https://www.city.kuji.lg.jp/kanko_bunka_sports/kanko/4/5594.html',
    date '2026-09-26', 'unknown', 'unknown', null, true
  ),
  (
    'p_59e5c749847f43', 'w_a656528c3afb5a',
    '首里金城町の石畳道', '沖縄県・那覇市',
    26.2145349, 127.7143636,
    'https://www.okinawastory.jp/news/tourism/4431',
    'https://www.openstreetmap.org/way/124868413', now(),
    '那覇の古波蔵家前の場面に登場した石畳道。',
    '公道の石畳区間を散策。周辺は住宅地です。私有地に入らず、雨天時の滑りやすい路面に注意してください。',
    20,
    'ピンは石畳道の一部の中心付近で、撮影地点を特定するものではありません。',
    'https://www.okinawastory.jp/news/tourism/4431',
    date '2026-09-26', 'no_hours', 'not_required', 0, true
  ),
  (
    'p_6272e398ebf305', 'w_a656528c3afb5a',
    '牧志公園', '沖縄県・那覇市',
    26.2179153, 127.6918450,
    'https://www.okinawastory.jp/news/tourism/4431',
    'https://www.openstreetmap.org/way/168428746', now(),
    '古波蔵恵尚がゴーヤーマンを反対された後の場面に登場した公園。',
    '公園の一般開放エリアを見学。現地の掲示や工事・催事による立入規制を確認してください。',
    15,
    'ピンは公園中心付近で、作品と同じ撮影視点ではありません。',
    'https://www.okinawastory.jp/news/tourism/4431',
    date '2026-09-26', 'no_hours', 'not_required', 0, true
  )
on conflict (id) do nothing;
