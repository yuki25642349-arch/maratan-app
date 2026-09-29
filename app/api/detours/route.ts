import type { VerifiedSpot } from "../../_data/anilist-types";
import { locateResearchSpot, placesApiKey, searchLocalDetours, type DetourAnchor } from "../../_data/google-places";
import { consistentAnchors, isPlaceId } from "../../_data/local-detours";
import { researchSpotsForWork } from "../../_data/research-spots";

export const runtime = "nodejs";

// 地域の寄り道は DB ではなく、Gemini（Google マップ グラウンディング）と Places API から取得する。
// 聖地の座標はクライアントの値を信用せず、DB の確認済み地点を再取得して使う。

// spotIds は DB の確認済み聖地（p_...）、researchSpotIds は同梱の調査リストの地点（r_... / oshi_...）。どちらか一方を受け取る。
type Input = { workId: string; region: string; spotIds?: string[]; researchSpotIds?: string[]; visitDate: string; pinPlaceId?: string };

const requestTimes = new Map<string, number[]>();
const LIMIT_PER_MINUTE = 6;

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

function validate(value: unknown): Input | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<Input>;
  if (typeof item.workId !== "string" || !/^w_[a-z0-9]+$/.test(item.workId)) return null;
  if (typeof item.region !== "string" || item.region.length < 1 || item.region.length > 80) return null;
  const ids = item.spotIds ?? item.researchSpotIds;
  if ((item.spotIds === undefined) === (item.researchSpotIds === undefined)) return null;
  if (item.pinPlaceId !== undefined && !isPlaceId(item.pinPlaceId)) return null;
  const pattern = item.spotIds ? /^p_[a-z0-9]+$/ : /^(?:r_[a-z0-9]+|oshi_sp-[a-z0-9]+)$/;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 3 ||
    ids.some((id) => typeof id !== "string" || !pattern.test(id)) || new Set(ids).size !== ids.length) return null;
  if (typeof item.visitDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item.visitDate)) return null;
  return item as Input;
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "許可されていない送信元です。" }, { status: 403 });
  let raw: unknown;
  try {
    const body = await request.text();
    if (body.length > 2048) return Response.json({ error: "入力が大きすぎます。" }, { status: 413 });
    raw = JSON.parse(body);
  } catch { return Response.json({ error: "JSON形式で入力してください。" }, { status: 400 }); }
  const input = validate(raw);
  if (!input) return Response.json({ error: "作品・地域・聖地・訪問日を確認してください。" }, { status: 400 });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) return Response.json({ error: "寄り道の検索回数が多いため、少し待って再試行してください。" }, { status: 429 });

  const placesKey = placesApiKey();
  if (!placesKey) return Response.json({ error: "寄り道の検索にはGoogle Places APIの設定が必要です（GOOGLE_PLACES_API_KEY）。", detours: [] }, { status: 503 });
  const geminiKey = process.env.GEMINI_API_KEY ?? "";

  if (input.researchSpotIds) {
    // 調査リストの地点：名称と地域は同梱データから取り、位置だけを Places API で求める。
    const catalog = researchSpotsForWork(input.workId).filter((spot) => spot.region === input.region);
    const chosen = input.researchSpotIds.map((id) => catalog.find((spot) => spot.id === id));
    if (chosen.some((spot) => !spot)) return Response.json({ error: "選んだ地点が見つかりません。" }, { status: 422 });
    try {
      const located = await Promise.all(chosen.map(async (spot) => {
        const place = await locateResearchSpot(spot!.name, spot!.region, placesKey);
        return place ? { ...place, id: spot!.id } : null;
      }));
      const found = located.filter((spot): spot is DetourAnchor & { placeId: string; mapsUri: string | null } => spot !== null);
      const anchors = consistentAnchors(found);
      if (!anchors.length) return Response.json({ error: "選んだ地点の位置をGoogleマップで特定できませんでした。地点を変えてお試しください。" }, { status: 422 });
      const result = await searchLocalDetours(anchors, input.region, input.visitDate, placesKey, geminiKey, input.pinPlaceId);
      return Response.json({ ...result, anchors: anchors.map(({ id, latitude, longitude, placeId, mapsUri }) => ({ id, latitude, longitude, placeId, mapsUri })),
        unlocated: input.researchSpotIds.filter((id) => !anchors.some((anchor) => anchor.id === id)) }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return Response.json({ error: "寄り道候補を取得できませんでした。時間をおいて再試行してください。" }, { status: 503 });
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return Response.json({ error: "作品DBの設定がありません。" }, { status: 503 });
  const spotIds = input.spotIds!;
  try {
    const spotsUrl = new URL(`${url}/rest/v1/verified_seichi_spots`);
    spotsUrl.searchParams.set("select", "id,work_id,name,region,latitude,longitude");
    spotsUrl.searchParams.set("work_id", `eq.${input.workId}`);
    spotsUrl.searchParams.set("region", `eq.${input.region}`);
    spotsUrl.searchParams.set("id", `in.(${spotIds.join(",")})`);
    const spotsResponse = await fetch(spotsUrl, { headers: { apikey: key }, cache: "no-store", signal: AbortSignal.timeout(7000) });
    if (!spotsResponse.ok) throw new Error("spots unavailable");
    const spots = await spotsResponse.json() as VerifiedSpot[];
    if (!Array.isArray(spots) || spots.length !== spotIds.length || spots.some((spot) => !Number.isFinite(spot.latitude) || !Number.isFinite(spot.longitude)))
      return Response.json({ error: "選択した確認済み聖地を取得できません。" }, { status: 422 });
    const ordered = spotIds.map((id) => spots.find((spot) => spot.id === id)!);
    const result = await searchLocalDetours(ordered, input.region, input.visitDate, placesKey, geminiKey, input.pinPlaceId);
    return Response.json({ ...result, routable: Boolean(process.env.GOOGLE_ROUTES_API_KEY) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "寄り道候補を取得できませんでした。時間をおいて再試行してください。" }, { status: 503 });
  }
}
