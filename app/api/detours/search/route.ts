import { placesApiKey } from "../../../_data/google-places";
import { categoryFromTypes, extractJson, normalizePlaceId, safeMapsUri } from "../../../_data/local-detours";
import { addressInRegion, categoryForWord, cleanQuery, pickKnownRegions, regionsMatchingText, splitRegion } from "../../../_data/food-search";
import { loadResearchWorks } from "../../../_data/research-works";

export const runtime = "nodejs";

// 「うに」「地酒」「和菓子」などのキーワードで、聖地がある地域の地元の店・施設を探し、
// その地域の聖地（作品）へ進めるようにする。
// 1) DB に登録した寄り道（verified_local_detours）を部分一致で探す
// 2) Gemini が「そのキーワードが名物の地域」をアプリの対応地域の中から選び、Places API で実在の店を探す
// AI には店名を作らせず、店はすべて Places API の検索結果から出す。

type Detour = { id: string; name: string; region: string; category: string; local_relevance: string;
  placeId: string | null; mapsUri: string | null; address: string | null };
type Result = { detour: Detour; works: Array<{ workId: string; title: string }> };

const PLACES_SEARCH = "https://places.googleapis.com/v1/places:searchText";
const PLACE_FIELDS = "places.id,places.displayName,places.formattedAddress,places.googleMapsUri,places.primaryType,places.types,places.businessStatus";
const MAX_RESULTS = 20;
const requestTimes = new Map<string, number[]>();
const LIMIT_PER_MINUTE = 8;

function rateLimited(ip: string) {
  const now = Date.now();
  for (const [key, times] of requestTimes) {
    const recent = times.filter((time) => now - time < 60_000);
    if (recent.length) requestTimes.set(key, recent);
    else requestTimes.delete(key);
  }
  const times = requestTimes.get(ip) ?? [];
  if (times.length >= LIMIT_PER_MINUTE) return true;
  requestTimes.set(ip, [...times, now]);
  return false;
}

type PlaceHit = { id?: string; displayName?: { text?: string }; formattedAddress?: string; googleMapsUri?: string; primaryType?: string; types?: string[]; businessStatus?: string };

async function placesSearch(textQuery: string, key: string, maxResultCount: number): Promise<PlaceHit[]> {
  try {
    const response = await fetch(PLACES_SEARCH, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": PLACE_FIELDS },
      body: JSON.stringify({ textQuery, languageCode: "ja", regionCode: "JP", maxResultCount }),
      cache: "no-store", signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) return [];
    const data = await response.json() as { places?: PlaceHit[] };
    return Array.isArray(data.places) ? data.places : [];
  } catch { return []; }
}

function toDetour(place: PlaceHit, region: string): Detour | null {
  const placeId = normalizePlaceId(place.id);
  const name = place.displayName?.text?.trim();
  if (!placeId || !name || (place.businessStatus && place.businessStatus !== "OPERATIONAL")) return null;
  if (!addressInRegion(place.formattedAddress, region)) return null;
  return { id: placeId, placeId, name, region, category: categoryFromTypes(place.primaryType, place.types), local_relevance: "",
    mapsUri: safeMapsUri(place.googleMapsUri), address: place.formattedAddress?.replace(/^日本、\s*(〒\d{3}-\d{4}\s*)?/, "") ?? null };
}

/** キーワードが地元の名物・文化として知られる地域を、対応地域の中から Gemini に選ばせる。 */
async function geminiRegions(query: string, regions: readonly string[], geminiKey: string) {
  if (!geminiKey) return null;
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(process.env.GEMINI_MODEL || "gemini-3.5-flash-lite")}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: "あなたは日本の地域の名物・特産・伝統文化に詳しい案内役です。必ず提示された地域名の中からだけ選び、そのまま返してください。" }] },
        contents: [{ role: "user", parts: [{ text: `キーワード「${query}」について、次の地域のうち、それが地元の名物・特産・伝統文化として知られ、地元の店や施設で味わったり体験したりしやすい地域を、関連が強い順に最大4つ選んでください。当てはまる地域がなければ空の配列にしてください。\n地域:\n${regions.join("\n")}` }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: { type: "ARRAY", items: { type: "STRING" } } },
      }),
      cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return pickKnownRegions(extractJson(data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? ""), regions);
  } catch { return null; }
}

async function databaseDetours(query: string): Promise<Detour[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return [];
  const category = categoryForWord(query);
  const conditions = [`name.ilike.*${query}*`, `local_relevance.ilike.*${query}*`, ...(category ? [`category.eq.${category}`] : [])];
  try {
    const endpoint = new URL(`${url}/rest/v1/verified_local_detours`);
    endpoint.searchParams.set("select", "id,name,region,category,local_relevance");
    endpoint.searchParams.set("published", "eq.true");
    endpoint.searchParams.set("or", `(${conditions.join(",")})`);
    endpoint.searchParams.set("order", "name.asc");
    endpoint.searchParams.set("limit", String(MAX_RESULTS));
    const response = await fetch(endpoint, { headers: { apikey: key }, cache: "no-store", signal: AbortSignal.timeout(7000) });
    if (!response.ok) return [];
    const rows = await response.json() as Array<{ id: string; name: string; region: string; category: string; local_relevance: string }>;
    return Array.isArray(rows) ? rows.map((row) => ({ ...row, local_relevance: row.local_relevance ?? "", placeId: null, mapsUri: null, address: null })) : [];
  } catch { return []; }
}

export async function GET(request: Request) {
  const raw = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (raw.length < 1 || raw.length > 40) return Response.json({ error: "キーワードは1〜40文字で入力してください。" }, { status: 400 });
  const query = cleanQuery(raw);
  if (!query) return Response.json({ results: [] }, { headers: { "Cache-Control": "no-store" } });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) return Response.json({ error: "検索回数が多いため、少し待って再試行してください。" }, { status: 429 });

  // 聖地がある地域と、その地域の作品（DB と同梱の調査データ）。
  const catalog = await loadResearchWorks();
  const worksByRegion = new Map<string, Array<{ workId: string; title: string }>>();
  for (const work of catalog.works) {
    for (const region of work.regions) worksByRegion.set(region, [...(worksByRegion.get(region) ?? []), { workId: work.id, title: work.title }]);
  }
  const regions = [...worksByRegion.keys()];

  const placesKey = placesApiKey();
  const [fromDatabase, aiRegions] = await Promise.all([
    databaseDetours(query),
    placesKey ? geminiRegions(query, regions, process.env.GEMINI_API_KEY ?? "") : Promise.resolve(null),
  ]);

  const found: Detour[] = [...fromDatabase];
  let searchedRegions: string[] = [];
  if (placesKey) {
    const category = categoryForWord(query);
    searchedRegions = [...new Set([...regionsMatchingText(query, regions), ...(aiRegions ?? [])])].slice(0, 4);
    if (searchedRegions.length) {
      // 地域名だけの検索（「飛騨」など）は、その地域の地元の食・文化を探す。
      const regionOnly = regionsMatchingText(query, regions).length > 0;
      const hits = await Promise.all(searchedRegions.map(async (region) => {
        const { prefecture, city } = splitRegion(region);
        const words = regionOnly ? "郷土料理 名物" : category === "food" ? "郷土料理" : category === "shopping" ? "特産品 お土産" : category === "culture" ? "伝統工芸 資料館" : query;
        return (await placesSearch(`${prefecture} ${city} ${words}`, placesKey, 4)).map((place) => toDetour(place, region));
      }));
      found.push(...hits.flat().filter((detour): detour is Detour => detour !== null));
    } else {
      // 地域を選べなかったときは全国で探し、アプリの対応地域にある店だけを残す。
      const hits = await placesSearch(query, placesKey, 20);
      for (const place of hits) {
        const region = regions.find((item) => addressInRegion(place.formattedAddress, item));
        const detour = region ? toDetour(place, region) : null;
        if (detour) found.push(detour);
      }
    }
  }

  const seen = new Set<string>();
  const results: Result[] = found.filter((detour) => {
    const key = `${detour.placeId ?? detour.id}|${detour.region}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_RESULTS).map((detour) => ({ detour, works: worksByRegion.get(detour.region) ?? [] }));

  if (!results.length && !placesKey && !process.env.NEXT_PUBLIC_SUPABASE_URL)
    return Response.json({ error: "お店の検索に必要な設定（Places API）がありません。" }, { status: 503 });
  return Response.json({ results, regions: searchedRegions }, { headers: { "Cache-Control": "no-store" } });
}
