# 聖地リストの取り込み

対象: Supabase project `nwvqtxyxotctdqiddszn`

- 原本: `japan_seichi_research_2026-09-25.csv`（233行、22列）
- ローカル再現用: `supabase/migrations/20260926065700_create_research_catalog.sql` と `supabase/seed.sql`
- 本番の取込先: `public.seichi_research_import`（RLS 有効、匿名ユーザーには非公開）
- 検索用: `public.research_works`（作品名・版・分類・地域・掲載件数のみ公開）

本番DBへのCSVアップロードと `supabase/refresh_research_works.sql` の集約は完了しました。2026-09-26 に以下を確認しています。

本番のテーブルはダッシュボードで先に作成したため、この migration をそのまま同じ本番 DB に `db push` すると重複作成エラーになります。migration は新規環境向けの再現用です。

```sql
select count(*) from public.seichi_research_import; -- 233
select count(*) from public.research_works; -- 93
```

取込テーブルのレコードIDは233件すべて一意で、公開検索用テーブルの掲載件数合計も233件です。公開APIは93作品を返し、画面では「小樽」2作品・「Love Letter」1作品の検索結果を確認しました。

アプリは DB に作品がある場合は DB を表示し、DB が空または接続できない場合は同じ CSV 由来のプレビューを表示します。プレビュー表示中は未同期であることを画面に明記します。

CSVの全地点は座標・訪問可否が未確認のため、検索だけに使用し、コース作成対象には含めません。

## AniList候補検索と進行条件

- アニメ名を2文字以上入力したときだけ、サーバー側の `/api/anilist/search` からAniList GraphQL APIを検索します。作品データの一括同期はしません。
- 候補を選ぶとAniList IDで `public.research_works.anilist_id` を照合します。版まで照合できた23作品にIDを設定済みです。曖昧な2作品は未設定で、推測で紐づけません。
- 一致する作品があっても、`public.verified_seichi_spots` に座標と訪問条件を確認した地点がない場合、地域・聖地マップに進めません。
- 確認済み地点が存在する地域のみ選択でき、実座標の地図と出典リンクを表示します。CSVの調査中地点は混ぜません。画面から架空データのコース作成デモは除外しました。
- ローカル再現用に `supabase/migrations/20260926073221_add_anilist_search.sql` と `supabase/anilist-id-map.sql` を追加しました。本番DBには同等のスキーマ変更・ID登録を実施済みです。既存本番へこのmigrationを再適用しないでください。

## 実データの周遊コース（先行対応）

2026-09-26、飛騨市の公式観光コースと図書館公式案内に基づき、「君の名は。」の飛騨市図書館・飛騨古川駅を確認済み地点として登録しました。施設中心の座標はOpenStreetMapの個別地点に基づき、作品と同じ撮影位置ではありません。

- 作品・訪問の根拠: https://www.hida-kankou.jp/courses/73
- 図書館の開館・休館条件: https://hida-lib.jp/toshow/html/access.html
- 座標の根拠: https://www.openstreetmap.org/way/479056924 と https://www.openstreetmap.org/way/478848236
- 確認済み移動区間: 図書館 → 飛騨古川駅、徒歩約7分（飛騨市公式観光コース）。逆方向の所要時間は推測せず登録していません。

実コース画面では、選択した1～3地点と訪問日、周遊に使える時間から、根拠のある有向区間でつながる訪問順だけを提案します。区間が欠ける場合は所要時間を捏造せず、作成を止めます。図書館の月曜・最終金曜は定例休館として先に検出します。ただし月曜祝日の例外・翌平日、特別点検、年末年始、臨時休館は自動判定できないため、当日の公式情報確認チェックを必須にしています。到着時刻や営業時間内に入館できるかも判定していません。移動時間は出典の掲載時点の目安で、リアルタイムの所要時間ではありません。

新規環境用のスキーマは `supabase/migrations/20260926075606_add_verified_course_data.sql`、2地点と区間の初期データは `supabase/seed.sql` にあります。本番DBには同等のスキーマ・データを登録済みです。既存本番へmigrationやseedを重ねて流さないでください。
