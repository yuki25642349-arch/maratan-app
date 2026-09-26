import type { VerifiedLeg, VerifiedSpot } from "../../_data/anilist-types";

export async function GET(request: Request) {
  const workId = new URL(request.url).searchParams.get("workId") ?? "";
  if (!/^w_[a-z0-9]+$/.test(workId)) return Response.json({ error: "作品IDが不正です。" }, { status: 400 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return Response.json({ error: "作品DBの設定がありません。" }, { status: 503 });
  try {
    const headers = { apikey: key };
    const spotsResponse = await fetch(`${url}/rest/v1/verified_seichi_spots?select=id,work_id,name,region,latitude,longitude,source_url,coordinate_source_url,access_note,stay_minutes,closed_weekdays,closed_last_friday,notes&work_id=eq.${workId}&order=name.asc`, { headers, cache: "no-store" });
    if (!spotsResponse.ok) throw new Error("spots unavailable");
    const spots = await spotsResponse.json() as VerifiedSpot[];
    if (!Array.isArray(spots)) throw new Error("invalid spots");
    if (!spots.length) return Response.json({ spots: [], legs: [] });
    const ids = spots.map((spot) => spot.id);
    const metadataUrl = new URL(`${url}/rest/v1/verified_seichi_spots`);
    metadataUrl.searchParams.set("select", "id,relationship_note,entrance_note,official_url,source_checked_at,hours_status,opening_hours,last_admission,reservation_status,admission_yen,exceptional_closed_dates");
    metadataUrl.searchParams.set("id", `in.(${ids.join(",")})`);
    const metadataResponse = await fetch(metadataUrl, { headers, cache: "no-store" });
    if (metadataResponse.ok) {
      const metadata = await metadataResponse.json() as Array<Partial<VerifiedSpot> & { id: string }>;
      if (Array.isArray(metadata)) {
        const byId = new Map(metadata.map((item) => [item.id, item]));
        for (const spot of spots) Object.assign(spot, byId.get(spot.id));
      }
    }
    const legsResponse = await fetch(`${url}/rest/v1/verified_travel_legs?select=from_spot_id,to_spot_id,mode,minutes,source_url&from_spot_id=in.(${ids.join(",")})&limit=500`, { headers, cache: "no-store" });
    if (!legsResponse.ok) throw new Error("legs unavailable");
    const legs = await legsResponse.json() as VerifiedLeg[];
    if (!Array.isArray(legs)) throw new Error("invalid legs");
    const ownIds = new Set(ids);
    return Response.json({ spots, legs: legs.filter((leg) => ownIds.has(leg.to_spot_id)) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "確認済み聖地を取得できませんでした。" }, { status: 503 });
  }
}
