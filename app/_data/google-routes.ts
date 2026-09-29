import { chooseLeg, transitKindOf, type LegOption } from "./transit-label";

// サーバー専用：Google Routes API で、隣り合う2地点の徒歩とバス・電車の移動時間を調べる。

export type RouteEnd = { latitude: number; longitude: number } | { placeId: string };
export type RouteOption = LegOption & { walkingMeters: number | null; fareYen: number | null };
export type LegResult = RouteOption & { alternative: LegOption | null };

const ALLOWED_VEHICLES = new Set(["BUS", "INTERCITY_BUS", "TROLLEYBUS", "SHARE_TAXI", "SUBWAY", "TRAIN", "RAIL", "HEAVY_RAIL", "COMMUTER_TRAIN", "HIGH_SPEED_TRAIN", "LIGHT_RAIL", "TRAM", "MONORAIL"]);

function minutes(duration: unknown) {
  if (typeof duration !== "string" || !/^\d+(?:\.\d+)?s$/.test(duration)) return null;
  const value = Math.ceil(Number(duration.slice(0, -1)) / 60);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** 訪問日の昼（日本時間）を代表時刻として検索する。便の時刻は表示しない。 */
function representativeDeparture(date: string) {
  const noonJst = new Date(`${date}T03:00:00Z`).getTime();
  return new Date(Math.max(noonJst, Date.now() + 10 * 60_000)).toISOString();
}

function waypoint(end: RouteEnd) {
  return "placeId" in end ? { placeId: end.placeId } : { location: { latLng: { latitude: end.latitude, longitude: end.longitude } } };
}

type RoutesResponse = { routes?: Array<{ duration?: unknown; travelAdvisory?: { transitFare?: { units?: string; nanos?: number; currencyCode?: string } };
  legs?: Array<{ steps?: Array<{ travelMode?: string; distanceMeters?: number; transitDetails?: { transitLine?: { vehicle?: { type?: string } } } }> }> }> };

export async function routeOption(from: RouteEnd, to: RouteEnd, mode: "walking" | "transit", date: string, key: string): Promise<RouteOption | null> {
  try {
    const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "routes.duration,routes.legs.steps.travelMode,routes.legs.steps.distanceMeters,routes.legs.steps.transitDetails.transitLine.vehicle.type,routes.travel_advisory.transitFare" },
      body: JSON.stringify({
        origin: waypoint(from), destination: waypoint(to),
        travelMode: mode === "walking" ? "WALK" : "TRANSIT",
        ...(mode === "transit" ? { departureTime: representativeDeparture(date), transitPreferences: { allowedTravelModes: ["BUS", "SUBWAY", "TRAIN", "LIGHT_RAIL", "RAIL"] } } : {}),
        languageCode: "ja-JP",
      }),
      signal: AbortSignal.timeout(8000), cache: "no-store",
    });
    if (!response.ok) return null;
    const routes = (await response.json() as RoutesResponse).routes;
    if (!Array.isArray(routes)) return null;
    for (const route of routes) {
      const duration = minutes(route.duration);
      const steps = route.legs?.flatMap((leg) => leg.steps ?? []) ?? [];
      if (duration === null || !steps.length || steps.some((step) => step.travelMode !== "WALK" && step.travelMode !== "TRANSIT")) continue;
      const vehicles = steps.filter((step) => step.travelMode === "TRANSIT").map((step) => step.transitDetails?.transitLine?.vehicle?.type ?? "");
      if (vehicles.some((type) => !ALLOWED_VEHICLES.has(type))) continue;
      if (mode === "transit" && !vehicles.length) continue;
      const walkingSteps = steps.filter((step) => step.travelMode === "WALK");
      const walkingMeters = walkingSteps.every((step) => Number.isFinite(step.distanceMeters))
        ? walkingSteps.reduce((sum, step) => sum + (step.distanceMeters ?? 0), 0) : null;
      const fare = route.travelAdvisory?.transitFare;
      const fareYen = mode === "walking" ? 0 : fare?.currencyCode === "JPY" && Number.isFinite(Number(fare.units))
        ? Number(fare.units) + (fare.nanos ?? 0) / 1_000_000_000 : null;
      return { mode, minutes: duration, walkingMeters, fareYen, transitKind: mode === "transit" ? transitKindOf(vehicles) : null };
    }
    return null;
  } catch { return null; }
}

/** 徒歩とバス・電車の両方を調べ、速いほうを選ぶ。もう一方も比較用に返す。 */
export async function computeLeg(from: RouteEnd, to: RouteEnd, date: string, key: string): Promise<LegResult | null> {
  const [walking, transit] = await Promise.all([routeOption(from, to, "walking", date, key), routeOption(from, to, "transit", date, key)]);
  const picked = chooseLeg(walking, transit);
  if (!picked) return null;
  const alternative = picked.alternative ? { mode: picked.alternative.mode, minutes: picked.alternative.minutes, transitKind: picked.alternative.transitKind } : null;
  return { ...picked.chosen, alternative };
}
