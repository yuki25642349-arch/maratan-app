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
};

export type VerifiedDetour = VerifiedSpot & { kind: "detour"; category: string; local_relevance: string };

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
