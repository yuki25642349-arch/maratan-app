export type AniListSuggestion = {
  id: number;
  title: { native: string | null; romaji: string | null; english: string | null };
  format: string | null;
  seasonYear: number | null;
};

export type MatchedWork = {
  id: string;
  title: string;
  version: string | null;
  regions: string[];
  anilist_id: number;
};

export type VerifiedSpot = {
  id: string;
  work_id: string;
  name: string;
  region: string;
  latitude: number;
  longitude: number;
  source_url: string;
  coordinate_source_url: string | null;
  access_note: string;
  stay_minutes: number;
  closed_weekdays: number[];
  closed_last_friday: boolean;
  notes: string | null;
  kind?: "seichi" | "detour";
  category?: string | null;
  local_relevance?: string | null;
  exceptional_closed_dates?: string[];
  relationship_note?: string | null;
  entrance_note?: string | null;
  official_url?: string | null;
  source_checked_at?: string | null;
  hours_status?: "unknown" | "no_hours" | "hours_known";
  opening_hours?: unknown;
  last_admission?: string | null;
  reservation_status?: "unknown" | "required" | "not_required";
  admission_yen?: number | null;
  reference_price_yen?: number | null;
  // 以下は Gemini と Google マップから取得した地域の寄り道だけが持つ。
  place_id?: string;
  maps_uri?: string | null;
  local_feature?: string | null;
  detour_reason?: string | null;
  slot_label?: string | null;
  detour_slot?: { kind: "between"; fromId: string; toId: string } | { kind: "near"; spotId: string } | null;
  opening_hours_text?: string | null;
  weekday_hours?: string[] | null;
  // Places API (New) の「AIによるクチコミ要約」。保存せず、取得のたびにそのまま表示する。
  // 「食・お店から探す」で利用者が選んだ店。コースに必ず入れる候補にする。
  pinned?: boolean;
  review_summary?: { text: string; disclosure: string; flagUri: string; reviewsUri: string } | null;
  detour_source?: "gemini-maps" | "places-search";
};

export type VerifiedDetour = VerifiedSpot & {
  kind: "detour";
  category: "food" | "shopping" | "culture" | "experience";
  local_relevance: string;
  place_id: string;
  maps_uri: string | null;
};

export type VerifiedLeg = {
  from_spot_id: string;
  to_spot_id: string;
  mode: "walking" | "transit";
  minutes: number;
  source_url: string;
};

export type AniListMatch =
  | { status: "unregistered" }
  | { status: "unverified"; work: MatchedWork }
  | { status: "ready"; work: MatchedWork; spots: VerifiedSpot[]; legs: VerifiedLeg[] };
