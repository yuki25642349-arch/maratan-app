import type { VerifiedLeg, VerifiedSpot } from "../../_data/anilist-types";
import { isKnownClosed, type VerifiedCourse } from "../../_data/real-planner";
import { detourFromPlace, fetchPlaceDetails, placesApiKey } from "../../_data/google-places";
import { computeLeg } from "../../_data/google-routes";
import { bestAxisOrder, isPlaceId, isWithinReach } from "../../_data/local-detours";
import type { LegOption, TransitKind } from "../../_data/transit-label";

export const runtime = "nodejs";

type RouteLeg = VerifiedLeg & { source: "google-routes" | "registered"; walkingMeters: number | null; fareYen: number | null;
  transitKind: TransitKind | null; alternative: LegOption | null };
type Course = Omit<VerifiedCourse, "legs"> & { legs: RouteLeg[]; id: string };
type Input = { workId: string; region: string; spotIds: string[]; detourIds?: string[]; visitDate: string; availableMinutes: number; stayMinutes?: Record<string, number> };

const requestTimes = new Map<string, number[]>();
const LIMIT_PER_MINUTE = 5;
const LONG_WALK_METERS = 3000;

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

function validDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return false;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return date >= today;
}

function validate(value: unknown): Input | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<Input>;
  if (typeof item.workId !== "string" || !/^w_[a-z0-9]+$/.test(item.workId)) return null;
  if (typeof item.region !== "string" || item.region.length < 1 || item.region.length > 80) return null;
  if (!Array.isArray(item.spotIds) || item.spotIds.length < 1 || item.spotIds.length > 3 ||
    item.spotIds.some((id) => typeof id !== "string" || !/^p_[a-z0-9]+$/.test(id)) ||
    new Set(item.spotIds).size !== item.spotIds.length) return null;
  if (item.detourIds !== undefined && (!Array.isArray(item.detourIds) || item.detourIds.length > 2 || item.detourIds.length + item.spotIds.length > 5 ||
    item.detourIds.some((id) => !isPlaceId(id)) || new Set(item.detourIds).size !== item.detourIds.length)) return null;
  if (typeof item.visitDate !== "string" || !validDate(item.visitDate)) return null;
  if (!Number.isInteger(item.availableMinutes) || item.availableMinutes! < 30 || item.availableMinutes! > 720) return null;
  if (item.stayMinutes !== undefined && (typeof item.stayMinutes !== "object" || item.stayMinutes === null || Array.isArray(item.stayMinutes) ||
    Object.entries(item.stayMinutes).some(([id, value]) => ![...item.spotIds!, ...(item.detourIds ?? [])].includes(id) || !Number.isInteger(value) || value < 5 || value > 180))) return null;
  return item as Input;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length < 2) return [items];
  return items.flatMap((item, index) => permutations(items.filter((_, other) => other !== index)).map((tail) => [item, ...tail]));
}

async function recommend(courses: Course[], budget: number): Promise<{ id: string; reason: string; source: "gemini" | "rule" }> {
  const fallback = courses[0];
  const groundedReason = (course: Course) => {
    const margin = budget - course.totalMinutes;
    const timeReason = margin >= 0
      ? `概算では地点間移動が約${course.moveMinutes}分で、指定時間に約${margin}分の余裕があります。`
      : `概算では指定時間を約${-margin}分超えるため、周遊時間の変更が必要です。`;
    const detour = course.stops.find((spot) => spot.kind === "detour");
    return `${timeReason}${detour ? `地域の寄り道「${detour.name}」を含みます。` : "選んだ聖地をすべて含みます。"}`;
  };
  const fallbackResult = { id: fallback.id, reason: groundedReason(fallback), source: "rule" as const };
  const key = process.env.GEMINI_API_KEY;
  if (!key || courses.length < 2) return fallbackResult;
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite", store: false,
        system_instruction: "あなたは周遊候補の順位だけを決めます。提示されたID以外を選ばず、未提供の地名・便・営業時間・帰着情報を創作しないでください。訪問時刻は未確定です。理由は日本語で短く『概算では』と表現し、施設の営業・見学可否や乗車・帰着を断定しないでください。",
        input: JSON.stringify({ budgetMinutes: budget, candidates: courses.map((course) => ({ id: course.id, stopNames: course.stops.map((spot) => spot.name), moveMinutes: course.moveMinutes, totalMinutes: course.totalMinutes })) }),
        response_format: { type: "text", mime_type: "application/json", schema: { type: "object", properties: { id: { type: "string" }, reason: { type: "string" } }, required: ["id", "reason"] } },
      }), signal: AbortSignal.timeout(8000), cache: "no-store",
    });
    if (!response.ok) return fallbackResult;
    const data: unknown = await response.json();
    const steps = (data as { steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> }).steps;
    const text = steps?.filter((step) => step.type === "model_output").flatMap((step) => step.content ?? []).find((item) => item.type === "text")?.text;
    if (!text) return fallbackResult;
    const result: unknown = JSON.parse(text);
    if (!result || typeof result !== "object") return fallbackResult;
    const pick = result as { id?: unknown; reason?: unknown };
    if (typeof pick.id !== "string" || !courses.some((course) => course.id === pick.id) || typeof pick.reason !== "string" || pick.reason.length > 180 || pick.reason.length < 1 ||
      /営業中|開館中|見学.{0,4}可能|訪問.{0,4}可能|必ず|確実|帰着|乗車できる|便に間に合う/.test(pick.reason)) return fallbackResult;
    const selected = courses.find((course) => course.id === pick.id)!;
    return { id: pick.id, reason: groundedReason(selected), source: "gemini" };
  } catch { return fallbackResult; }
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "許可されていない送信元です。" }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > 4096) return Response.json({ error: "入力が大きすぎます。" }, { status: 413 });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) return Response.json({ error: "作成回数が多いため、少し待って再試行してください。" }, { status: 429 });
  let raw: unknown;
  try {
    const body = await request.text();
    if (body.length > 4096) return Response.json({ error: "入力が大きすぎます。" }, { status: 413 });
    raw = JSON.parse(body);
  } catch { return Response.json({ error: "JSON形式で入力してください。" }, { status: 400 }); }
  const input = validate(raw);
  if (!input) return Response.json({ error: "作品、地点、訪問日、周遊時間を確認してください。" }, { status: 400 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return Response.json({ error: "作品DBの設定がありません。" }, { status: 503 });
  try {
    const headers = { apikey: key };
    const spotsUrl = new URL(`${url}/rest/v1/verified_seichi_spots`);
    spotsUrl.searchParams.set("select", "id,work_id,name,region,latitude,longitude,source_url,coordinate_source_url,access_note,stay_minutes,closed_weekdays,closed_last_friday,notes");
    spotsUrl.searchParams.set("work_id", `eq.${input.workId}`);
    spotsUrl.searchParams.set("region", `eq.${input.region}`);
    spotsUrl.searchParams.set("id", `in.(${input.spotIds.join(",")})`);
    const spotsResponse = await fetch(spotsUrl, { headers, cache: "no-store", signal: AbortSignal.timeout(7000) });
    if (!spotsResponse.ok) throw new Error("spots unavailable");
    const spots = await spotsResponse.json() as VerifiedSpot[];
    if (!Array.isArray(spots) || spots.length !== input.spotIds.length || spots.some((spot) => !Number.isFinite(spot.latitude) || !Number.isFinite(spot.longitude) || !Number.isInteger(spot.stay_minutes))) {
      return Response.json({ error: "選択した確認済み地点を取得できません。" }, { status: 422 });
    }
    const metadataUrl = new URL(`${url}/rest/v1/verified_seichi_spots`);
    metadataUrl.searchParams.set("select", "id,relationship_note,entrance_note,official_url,source_checked_at,hours_status,opening_hours,last_admission,reservation_status,admission_yen,exceptional_closed_dates");
    metadataUrl.searchParams.set("id", `in.(${input.spotIds.join(",")})`);
    const metadataResponse = await fetch(metadataUrl, { headers, cache: "no-store", signal: AbortSignal.timeout(7000) });
    if (metadataResponse.ok) {
      const metadata = await metadataResponse.json() as Array<Partial<VerifiedSpot> & { id: string }>;
      if (Array.isArray(metadata)) {
        const byId = new Map(metadata.map((item) => [item.id, item]));
        for (const spot of spots) Object.assign(spot, byId.get(spot.id));
      }
    }
    // 寄り道は Gemini・Google マップで見つけた Place ID だけを受け取り、Places API で位置と営業状態を取り直す。
    let detours: VerifiedSpot[] = [];
    if (input.detourIds?.length) {
      const placesKey = placesApiKey();
      if (!placesKey) return Response.json({ error: "寄り道の情報を確認できません。Google Places APIの設定を確認してください。" }, { status: 503 });
      const details = await Promise.all(input.detourIds.map((id) => fetchPlaceDetails(id, placesKey)));
      const found = details.map((place) => place ? detourFromPlace(place, input.region, input.visitDate, { localFeature: null, reason: null, source: "gemini-maps" }) : null);
      if (found.some((spot) => !spot)) return Response.json({ error: "選んだ寄り道の情報をGoogleマップで確認できませんでした。営業を終了した可能性があります。" }, { status: 422 });
      detours = found as VerifiedSpot[];
      if (detours.some((spot) => !isWithinReach(spot, spots)))
        return Response.json({ error: "選んだ寄り道が聖地から離れすぎています。別の寄り道を選んでください。" }, { status: 422 });
    }
    const stops = [...spots.map((spot) => ({ ...spot, kind: "seichi" as const })), ...detours];
    const closed = stops.filter((spot) => isKnownClosed(spot, input.visitDate));
    if (closed.length) return Response.json({ status: "closed", error: `${closed.map((spot) => spot.name).join("、")}は選んだ日が休業日です。訪問日を変更してください。` }, { status: 422 });

    const routeKey = process.env.GOOGLE_ROUTES_API_KEY;
    if (detours.length && !routeKey) return Response.json({ status: "unavailable", error: "寄り道を含む移動時間の計算にはGoogle Routes APIの設定が必要です。" }, { status: 503 });
    const byPair = new Map<string, RouteLeg>();
    let source: "google-routes" | "registered" | "mixed" = "registered";
    if (routeKey && stops.length > 1) {
      const pairs = stops.flatMap((from) => stops.filter((to) => to.id !== from.id).map((to) => ({ from, to })));
      // At most 20 directed pairs and 40 API calls per plan; limit concurrency.
      for (let offset = 0; offset < pairs.length; offset += 4) {
        await Promise.all(pairs.slice(offset, offset + 4).map(async ({ from, to }) => {
          const leg = await computeLeg(from, to, input.visitDate, routeKey);
          if (leg) byPair.set(`${from.id}/${to.id}`, { from_spot_id: from.id, to_spot_id: to.id, ...leg, source: "google-routes",
            source_url: "https://developers.google.com/maps/documentation/routes/overview" });
        }));
      }
      if (byPair.size) source = "google-routes";
    }
    if (byPair.size < stops.length * (stops.length - 1)) {
      const legsUrl = new URL(`${url}/rest/v1/verified_travel_legs`);
      legsUrl.searchParams.set("select", "from_spot_id,to_spot_id,mode,minutes,source_url");
      legsUrl.searchParams.set("from_spot_id", `in.(${input.spotIds.join(",")})`);
      legsUrl.searchParams.set("limit", "100");
      const legsResponse = await fetch(legsUrl, { headers, cache: "no-store", signal: AbortSignal.timeout(7000) });
      if (!legsResponse.ok) throw new Error("legs unavailable");
      const registered = await legsResponse.json() as VerifiedLeg[];
      for (const leg of registered) {
        if (input.spotIds.includes(leg.to_spot_id) && !byPair.has(`${leg.from_spot_id}/${leg.to_spot_id}`))
          byPair.set(`${leg.from_spot_id}/${leg.to_spot_id}`, { ...leg, walkingMeters: null, fareYen: null, transitKind: null, alternative: null, source: "registered" });
      }
    }
    // 聖地を軸にする：聖地の訪問順ごとに、寄り道は聖地と聖地の区間の中で移動が最も短くなる位置に入れる。
    const byId = new Map(stops.map((spot) => [spot.id, spot]));
    const candidateStops = permutations(spots.map((spot) => spot.id)).flatMap((seichiOrder) => {
      const best = bestAxisOrder(seichiOrder, detours.map((spot) => spot.id), (from, to) => byPair.get(`${from}/${to}`)?.minutes ?? null);
      return best ? [best.order.map((id) => byId.get(id)!)] : [];
    });
    const courses: Course[] = candidateStops.flatMap((ordered) => {
      const courseLegs = ordered.slice(0, -1).map((spot, index) => byPair.get(`${spot.id}/${ordered[index + 1].id}`));
      if (courseLegs.some((leg) => !leg)) return [];
      const complete = courseLegs as RouteLeg[];
      const stayMinutes = ordered.reduce((sum, spot) => sum + (input.stayMinutes?.[spot.id] ?? spot.stay_minutes), 0);
      const moveMinutes = complete.reduce((sum, leg) => sum + leg.minutes, 0);
      const bufferMinutes = 20;
      return [{ id: ordered.map((spot) => spot.id).join("~"), stops: ordered, legs: complete, stayMinutes, moveMinutes, bufferMinutes, totalMinutes: stayMinutes + moveMinutes + bufferMinutes }];
    }).sort((a, b) => (a.totalMinutes <= input.availableMinutes ? 0 : 1) - (b.totalMinutes <= input.availableMinutes ? 0 : 1) || a.moveMinutes - b.moveMinutes);
    if (!courses.length) return Response.json({ error: "選択地点間の経路が不足しています。API障害・対象期間外・未登録の可能性があります。地点や日付を変えるか、後で再試行してください。", status: "unavailable" }, { status: 422 });
    const withinBudget = courses.filter((item) => item.totalMinutes <= input.availableMinutes);
    const recommendation = await recommend(withinBudget.length ? withinBudget : courses, input.availableMinutes);
    const course = courses.find((item) => item.id === recommendation.id) ?? courses[0];
    if (course.legs.some((leg) => leg.source === "registered") && course.legs.some((leg) => leg.source === "google-routes")) source = "mixed";
    else if (course.legs.every((leg) => leg.source === "registered")) source = "registered";
    const admissionKnown = course.stops.every((spot) => spot.kind === "detour" || typeof spot.admission_yen === "number");
    const detourPricesKnown = course.stops.every((spot) => spot.kind !== "detour" || typeof spot.reference_price_yen === "number");
    const transitKnown = course.legs.every((leg) => leg.mode !== "transit" || leg.fareYen !== null);
    const conditionsKnown = course.stops.every((spot) => spot.hours_status === "no_hours" && spot.reservation_status === "not_required");
    const longestWalk = Math.max(0, ...course.legs.map((leg) => leg.mode === "walking" ? leg.walkingMeters ?? 0 : 0));
    const longWalk = longestWalk > LONG_WALK_METERS;
    const status = course.totalMinutes > input.availableMinutes ? "over" : admissionKnown && detourPricesKnown && transitKnown && conditionsKnown && !longWalk ? "fits" : "needs-check";
    return Response.json({ course, recommendation, source, status,
      stayMinutes: Object.fromEntries(stops.map((spot) => [spot.id, input.stayMinutes?.[spot.id] ?? spot.stay_minutes])),
      costs: { transitYen: transitKnown ? course.legs.reduce((sum, leg) => sum + (leg.fareYen ?? 0), 0) : null,
        admissionYen: admissionKnown ? course.stops.reduce((sum, spot) => sum + (spot.admission_yen ?? 0), 0) : null,
        foodExperienceYen: detourPricesKnown ? course.stops.reduce((sum, spot) => sum + (spot.kind === "detour" ? spot.reference_price_yen ?? 0 : 0), 0) : null },
      notices: [
      stops.length === 1 ? "訪問地点が1件のため、地点間の移動はありません。" : source !== "google-routes" ? "移動時間に登録済みの区間データを含みます。各区間の出典も確認してください。" : null,
      longWalk ? `徒歩で約${(longestWalk / 1000).toFixed(1)}km歩く区間があります。体力や天候に合わせて、バスやタクシーも検討してください。` : null,
      !conditionsKnown ? "営業時間・最終入場・予約の要否は、まだ確認できていない地点があります。" : null,
      detours.length ? "地域の寄り道はGeminiとGoogleマップの情報から選んだ候補です。訪問時間帯の営業・定休日・混雑は、各店舗・施設の公式情報で確認してください。" : null,
      !longWalk && course.legs.length && course.legs.every((leg) => leg.mode === "walking") ? "このコースはすべて徒歩の区間です。電車・バスのほうが楽な場合もあるため、Googleマップでも確認してください。" : null,
    ].filter((notice): notice is string => notice !== null) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable", error: "コースデータを取得できませんでした。時間をおいて再試行してください。" }, { status: 503 });
  }
}
