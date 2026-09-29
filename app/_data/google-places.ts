import type { VerifiedDetour } from "./anilist-types";

/** 寄り道探しの基準にする聖地。DBの確認済み聖地、または調査リストの地点を位置検索したもの。 */
export type DetourAnchor = { id: string; name: string; latitude: number; longitude: number };
import {
  categoryFromTypes, closedWeekdaysFromPeriods, intervalDetourCost, DEFAULT_DETOUR_STAY, extractJson, isWithinReach, matchGroundedPicks,
  metersBetween, normalizeName, normalizePlaceId, openingHoursTextFor, safeDetourText, safeMapsUri, slotLabel, suggestSlot,
  type GroundedPlace, type PlacePeriod,
} from "./local-detours";

// サーバー専用：地域の寄り道を Gemini（Google マップ グラウンディング）で探し、
// Places API (New) で実在・位置・営業状態を確かめる。

const PLACES_ENDPOINT = "https://places.googleapis.com/v1";
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";
const MAX_DETOUR_RESULTS = 6;
const DETAILS_FIELDS = "id,displayName,location,googleMapsUri,businessStatus,primaryType,types,regularOpeningHours,priceRange,websiteUri,reviewSummary";
const PLACE_ACCESS_NOTE = "Googleマップの情報をもとにした寄り道候補です。当日の営業時間・定休日・混雑は店舗や施設の公式情報で確認してください。";

export function placesApiKey() {
  return process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_ROUTES_API_KEY || "";
}

type PlaceDetails = {
  id?: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  googleMapsUri?: string;
  businessStatus?: string;
  primaryType?: string;
  types?: string[];
  regularOpeningHours?: { periods?: PlacePeriod[]; weekdayDescriptions?: string[] };
  priceRange?: { startPrice?: { currencyCode?: string; units?: string } };
  reviewSummary?: { text?: { text?: string }; disclosureText?: { text?: string }; flagContentUri?: string; reviewsUri?: string };
  websiteUri?: string;
};

type DetourText = { localFeature: string | null; reason: string | null; source: "gemini-maps" | "places-search" };

function weekdayHours(value: unknown) {
  return Array.isArray(value) && value.length === 7 && value.every((line) => typeof line === "string" && line.length <= 200) ? value as string[] : null;
}

/**
 * Google 公式の「AIによるクチコミ要約」。表示に必須の「Geminiで要約」の表記・報告リンク・クチコミへのリンクが
 * そろっているときだけ使う（そろわなければ表示しない）。
 */
function reviewSummaryOf(summary: PlaceDetails["reviewSummary"]) {
  const text = summary?.text?.text?.trim();
  const disclosure = summary?.disclosureText?.text?.trim();
  const flagUri = httpsUrl(summary?.flagContentUri);
  const reviewsUri = httpsUrl(summary?.reviewsUri);
  if (!text || !disclosure || !flagUri || !reviewsUri || text.length > 600) return null;
  return { text, disclosure, flagUri, reviewsUri };
}

function httpsUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try { return new URL(value).protocol === "https:" ? value : null; } catch { return null; }
}

/** Places API のレスポンスを、コース計算に使える寄り道へ変換する。営業終了・位置不明の場所は捨てる。 */
export function detourFromPlace(place: PlaceDetails, region: string, visitDate: string, text: DetourText): VerifiedDetour | null {
  const id = normalizePlaceId(place.id);
  const name = place.displayName?.text?.trim();
  const latitude = place.location?.latitude;
  const longitude = place.location?.longitude;
  if (!id || !name || typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (place.businessStatus && place.businessStatus !== "OPERATIONAL") return null;
  const category = categoryFromTypes(place.primaryType, place.types);
  const periods = place.regularOpeningHours?.periods;
  const start = place.priceRange?.startPrice;
  const mapsUri = safeMapsUri(place.googleMapsUri) ?? `https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query: name, query_place_id: id })}`;
  const localFeature = text.localFeature ?? "";
  return {
    id, place_id: id, work_id: "", name, region, latitude, longitude,
    source_url: mapsUri, maps_uri: mapsUri, coordinate_source_url: null,
    access_note: PLACE_ACCESS_NOTE, stay_minutes: DEFAULT_DETOUR_STAY[category],
    closed_weekdays: closedWeekdaysFromPeriods(periods), closed_last_friday: false, exceptional_closed_dates: [],
    notes: localFeature || null, kind: "detour", category, local_relevance: localFeature,
    local_feature: text.localFeature, detour_reason: text.reason, detour_source: text.source,
    official_url: httpsUrl(place.websiteUri),
    hours_status: Array.isArray(periods) && periods.length ? "hours_known" : "unknown",
    opening_hours_text: openingHoursTextFor(place.regularOpeningHours?.weekdayDescriptions, visitDate),
    weekday_hours: weekdayHours(place.regularOpeningHours?.weekdayDescriptions),
    last_admission: null, reservation_status: "unknown",
    reference_price_yen: start?.currencyCode === "JPY" && Number.isFinite(Number(start.units)) ? Number(start.units) : null,
    review_summary: reviewSummaryOf(place.reviewSummary),
  };
}

export async function fetchPlaceDetails(placeId: string, key: string): Promise<PlaceDetails | null> {
  const id = normalizePlaceId(placeId);
  if (!id) return null;
  const url = new URL(`${PLACES_ENDPOINT}/places/${id}`);
  url.searchParams.set("languageCode", "ja");
  url.searchParams.set("regionCode", "JP");
  try {
    const response = await fetch(url, { headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": DETAILS_FIELDS }, cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return data && typeof data === "object" ? data as PlaceDetails : null;
  } catch { return null; }
}

function centroid(spots: readonly DetourAnchor[]) {
  return {
    latitude: spots.reduce((sum, spot) => sum + spot.latitude, 0) / spots.length,
    longitude: spots.reduce((sum, spot) => sum + spot.longitude, 0) / spots.length,
  };
}

/** Googleマップ グラウンディングに使うモデル。指定モデルが使えない場合に備え、順に試す。 */
export function geminiDetourModels() {
  return [...new Set([process.env.GEMINI_DETOUR_MODEL, "gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"].filter((model): model is string => Boolean(model)))];
}

const DETOUR_INSTRUCTION = [
  "あなたは聖地巡礼の途中で地域の食や文化に触れられる寄り道を探す案内役です。",
  "必ず Google マップの検索結果に実在する場所だけを挙げ、存在を確認できない店や施設を作らないでください。",
  "営業時間・定休日・価格・予約の要否・混雑は書かないでください。作品との関係も書かないでください。",
  "出力は指定された JSON 配列だけにしてください。",
].join("\n");

function detourPrompt(spots: readonly DetourAnchor[], region: string) {
  const list = spots.map((spot, index) => `${index + 1}. ${spot.name}（緯度${spot.latitude.toFixed(5)}, 経度${spot.longitude.toFixed(5)}）`).join("\n");
  return `${region}で次の聖地を巡る人が、聖地と聖地の間や、最初の聖地の前・最後の聖地の後に立ち寄れる場所を Google マップで探してください。
目的は、聖地巡礼だけで終わらず、この地域ならではの食や文化に触れてもらうことです。

聖地:
${list}

探す場所の条件:
- どれかの聖地から約3km以内、または聖地と聖地を結ぶ道の途中にある
- 郷土料理・地元食材を使う飲食店、和菓子・地酒・特産品など地元の名物を扱う店、伝統工芸や郷土の歴史・祭りを伝える資料館や体験施設を優先する
- 全国チェーン店、コンビニ、宿泊施設、聖地そのものは除く
- 食と文化の両方が入るように、最大6件

出力形式（JSON 配列のみ）:
[{"name": "Googleマップ上の名称", "placeId": "分かる場合のみ Place ID", "localFeature": "触れられる地域の食・文化（40字以内）", "reason": "聖地巡礼の途中に寄る価値（80字以内）"}]`;
}

/** Gemini + Google マップ グラウンディングで寄り道の候補を取得する。根拠のない候補は捨てる。 */
async function geminiMapsCandidates(spots: readonly DetourAnchor[], region: string, geminiKey: string, getDetails: (placeId: string) => Promise<PlaceDetails | null>) {
  const center = centroid(spots);
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: DETOUR_INSTRUCTION }] },
    contents: [{ role: "user", parts: [{ text: detourPrompt(spots, region) }] }],
    tools: [{ googleMaps: {} }],
    toolConfig: { retrievalConfig: { latLng: center, languageCode: "ja" } },
  });
  let response: Response | null = null;
  for (const model of geminiDetourModels()) {
    response = await fetch(`${GEMINI_ENDPOINT}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey }, body,
      cache: "no-store", signal: AbortSignal.timeout(25_000),
    });
    // モデルが存在しない・グラウンディング非対応・そのモデルの利用枠がないときは次のモデルを試す。
    if (response.ok || ![400, 404, 429].includes(response.status)) break;
  }
  if (!response?.ok) return [];
  const data = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; groundingMetadata?: { groundingChunks?: Array<{ maps?: { uri?: string; title?: string; placeId?: string } }> } }>;
  };
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  const grounded: GroundedPlace[] = (candidate?.groundingMetadata?.groundingChunks ?? []).flatMap((chunk) => {
    const placeId = normalizePlaceId(chunk.maps?.placeId);
    const uri = safeMapsUri(chunk.maps?.uri);
    const title = chunk.maps?.title?.trim();
    return placeId && uri && title ? [{ placeId, uri, title }] : [];
  });
  if (!text || !grounded.length) return [];
  // グラウンディングの名前はローマ字のことがあるため、Places API の日本語名でも照合する。
  const withAliases = await Promise.all(grounded.slice(0, 10).map(async (place) => {
    const name = (await getDetails(place.placeId))?.displayName?.text?.trim();
    return name ? { ...place, aliases: [name] } : place;
  }));
  return matchGroundedPicks(extractJson(text), withAliases);
}

const SEARCH_QUERIES = [
  { query: "郷土料理", feature: "郷土料理" },
  { query: "和菓子 名物", feature: "地元の和菓子・名物" },
  { query: "酒蔵 地酒", feature: "地酒・酒蔵" },
  { query: "伝統工芸 体験", feature: "伝統工芸" },
  { query: "郷土資料館 歴史", feature: "郷土の歴史・文化" },
];

/** Gemini のグラウンディングが使えないときの予備：Places API のテキスト検索で候補を集める。 */
async function placesSearchCandidates(spots: readonly DetourAnchor[], region: string, key: string) {
  const center = centroid(spots);
  const radius = Math.min(10_000, Math.max(2000, ...spots.map((spot) => metersBetween(center, spot) + 2000)));
  const results = await Promise.allSettled(SEARCH_QUERIES.map(async ({ query, feature }) => {
    const response = await fetch(`${PLACES_ENDPOINT}/places:searchText`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.id,places.displayName,places.primaryType" },
      body: JSON.stringify({ textQuery: `${region} ${query}`, languageCode: "ja", regionCode: "JP", maxResultCount: 4,
        locationBias: { circle: { center, radius } } }),
      cache: "no-store", signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return [];
    const data = await response.json() as { places?: Array<{ id?: string; displayName?: { text?: string }; primaryType?: string }> };
    return (data.places ?? []).flatMap((place) => {
      const placeId = normalizePlaceId(place.id);
      const name = place.displayName?.text?.trim();
      return placeId && name ? [{ placeId, name, feature, primaryType: place.primaryType ?? "" }] : [];
    });
  }));
  const seen = new Set<string>();
  return results.flatMap((result) => result.status === "fulfilled" ? result.value : []).filter((item) => !seen.has(item.placeId) && seen.add(item.placeId));
}

/** 予備候補に、Gemini で地域の食・文化の紹介文を付ける（候補IDの外は選ばせない）。 */
async function describeSearchCandidates(candidates: Array<{ placeId: string; name: string; feature: string; primaryType: string }>, region: string, geminiKey: string) {
  if (!geminiKey || !candidates.length) return new Map<string, { localFeature: string; reason: string }>();
  try {
    const response = await fetch(`${GEMINI_ENDPOINT}/models/${encodeURIComponent(process.env.GEMINI_MODEL || "gemini-3.5-flash-lite")}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: DETOUR_INSTRUCTION }] },
        contents: [{ role: "user", parts: [{ text: `${region}で聖地巡礼の途中に寄る場所として、次の候補から地域の食・文化に触れられるものを最大6件選び、候補の id をそのまま使って返してください。名称と検索語から分かること以上は書かないでください。\n${JSON.stringify(candidates.map((item) => ({ id: item.placeId, name: item.name, searchedFor: item.feature, type: item.primaryType })))}` }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: { type: "ARRAY", items: { type: "OBJECT",
          properties: { id: { type: "STRING" }, localFeature: { type: "STRING" }, reason: { type: "STRING" } }, required: ["id", "localFeature", "reason"] } } },
      }),
      cache: "no-store", signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return new Map();
    const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const parsed = extractJson(data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "");
    const ids = new Set(candidates.map((item) => item.placeId));
    const picks = new Map<string, { localFeature: string; reason: string }>();
    for (const item of Array.isArray(parsed) ? parsed : []) {
      const pick = item as { id?: unknown; localFeature?: unknown; reason?: unknown };
      const id = normalizePlaceId(pick.id);
      const localFeature = safeDetourText(pick.localFeature, 60);
      const reason = safeDetourText(pick.reason, 120);
      if (id && ids.has(id) && localFeature && reason) picks.set(id, { localFeature, reason });
    }
    return picks;
  } catch { return new Map(); }
}

export type DetourSearchResult = { detours: VerifiedDetour[]; source: "gemini-maps" | "places-search" | "mixed" | "none";
  /** 利用者が選んだ店（pinnedPlaceId）の扱い。遠すぎる店はコースに入れない。 */
  pinned: "included" | "out-of-reach" | "none" };

/**
 * 選んだ聖地の間・前後で、地域の食や文化に触れられる寄り道を探す。
 * 1) Gemini + Google マップ グラウンディング → 2) 足りなければ Places テキスト検索 の順に試し、
 * どちらの候補も Places API の詳細で実在・営業状態・位置を確かめてから返す。
 */
export async function searchLocalDetours(spots: DetourAnchor[], region: string, visitDate: string, placesKey: string, geminiKey: string, pinnedPlaceId?: string): Promise<DetourSearchResult> {
  const names = Object.fromEntries(spots.map((spot) => [spot.id, spot.name]));
  const seichiNames = new Set(spots.map((spot) => normalizeName(spot.name)));
  const accepted = new Map<string, VerifiedDetour>();
  const sources = new Set<"gemini-maps" | "places-search">();
  // 同じ場所の詳細を何度も取りに行かない（グラウンディングの照合と確認で共用）。
  const detailsCache = new Map<string, Promise<PlaceDetails | null>>();
  const getDetails = (placeId: string) => {
    if (!detailsCache.has(placeId)) detailsCache.set(placeId, fetchPlaceDetails(placeId, placesKey));
    return detailsCache.get(placeId)!;
  };

  async function accept(placeId: string, text: DetourText) {
    if (accepted.has(placeId)) return;
    const details = await getDetails(placeId);
    const detour = details ? detourFromPlace(details, region, visitDate, text) : null;
    if (!detour || accepted.has(detour.id) || seichiNames.has(normalizeName(detour.name))) return;
    if (!isWithinReach(detour, spots) || spots.some((spot) => metersBetween(spot, detour) < 30)) return;
    detour.detour_slot = suggestSlot(detour, spots);
    detour.slot_label = slotLabel(detour.detour_slot, names);
    accepted.set(detour.id, detour);
    sources.add(text.source);
  }

  // 「食・お店から探す」で選ばれた店は、ほかの候補より先に確認する。
  if (pinnedPlaceId) {
    await accept(pinnedPlaceId, { localFeature: null, reason: null, source: "places-search" });
    const pinned = accepted.get(pinnedPlaceId);
    if (pinned) pinned.pinned = true;
  }
  if (geminiKey) {
    try {
      const picks = await geminiMapsCandidates(spots, region, geminiKey, getDetails);
      await Promise.all(picks.slice(0, 8).map((pick) => accept(pick.placeId, { localFeature: pick.localFeature, reason: pick.reason, source: "gemini-maps" })));
    } catch { /* 予備の検索に進む */ }
  }
  if (accepted.size < 3) {
    const candidates = (await placesSearchCandidates(spots, region, placesKey)).slice(0, 12);
    const described = await describeSearchCandidates(candidates, region, geminiKey);
    const ordered = described.size ? candidates.filter((item) => described.has(item.placeId)) : candidates;
    for (let offset = 0; offset < ordered.length && accepted.size < MAX_DETOUR_RESULTS; offset += 4) {
      await Promise.all(ordered.slice(offset, offset + 4).map((item) => {
        const text = described.get(item.placeId);
        return accept(item.placeId, { localFeature: text?.localFeature ?? item.feature, reason: text?.reason ?? null, source: "places-search" });
      }));
    }
  }
  // 聖地と聖地の区間の途中にある（遠回りが少ない）順に並べる。先頭の候補が最初からコースに入る。
  // 利用者が選んだ店を先頭にする。
  const detours = [...accepted.values()].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || intervalDetourCost(a, spots) - intervalDetourCost(b, spots)).slice(0, MAX_DETOUR_RESULTS);
  const source = sources.size === 2 ? "mixed" : sources.has("gemini-maps") ? "gemini-maps" : sources.has("places-search") ? "places-search" : "none";
  const pinned = !pinnedPlaceId ? "none" : detours.some((spot) => spot.id === pinnedPlaceId) ? "included" : "out-of-reach";
  return { detours, source, pinned };
}

/**
 * 調査リストの聖地（出典で確認した名称）の位置を Places API のテキスト検索で求める。
 * 聖地かどうかの判断には使わず、寄り道探しと経路リンクの基準点にだけ使う。
 */
export async function locateResearchSpot(name: string, region: string, key: string): Promise<(DetourAnchor & { placeId: string; mapsUri: string | null }) | null> {
  try {
    const response = await fetch(`${PLACES_ENDPOINT}/places:searchText`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.googleMapsUri" },
      body: JSON.stringify({ textQuery: `${region.replace("・", " ")} ${name}`, languageCode: "ja", regionCode: "JP", maxResultCount: 1 }),
      cache: "no-store", signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return null;
    const data = await response.json() as { places?: Array<{ id?: string; location?: { latitude?: number; longitude?: number }; googleMapsUri?: string }> };
    const place = data.places?.[0];
    const placeId = normalizePlaceId(place?.id);
    const latitude = place?.location?.latitude;
    const longitude = place?.location?.longitude;
    if (!placeId || typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { id: "", name, latitude, longitude, placeId, mapsUri: safeMapsUri(place?.googleMapsUri) };
  } catch { return null; }
}
