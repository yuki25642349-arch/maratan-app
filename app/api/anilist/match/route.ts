import type { AniListMatch, MatchedWork, VerifiedLeg, VerifiedSpot } from "../../../_data/anilist-types";

export async function GET(request: Request) {
  const idText = new URL(request.url).searchParams.get("id") ?? "";
  const anilistId = Number(idText);
  if (!/^\d+$/.test(idText) || !Number.isSafeInteger(anilistId) || anilistId <= 0) {
    return Response.json({ error: "AniList IDが不正です。" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return Response.json({ error: "作品DBの設定がありません。" }, { status: 503 });

  try {
    const headers = { apikey: key };
    const workResponse = await fetch(
      `${url}/rest/v1/research_works?select=id,title,version,regions,anilist_id&anilist_id=eq.${anilistId}&limit=1`,
      { headers, cache: "no-store" },
    );
    if (!workResponse.ok) throw new Error("works unavailable");
    const works: unknown = await workResponse.json();
    if (!Array.isArray(works)) throw new Error("invalid works response");
    if (works.length === 0) return Response.json({ status: "unregistered" } satisfies AniListMatch);

    const work = works[0] as MatchedWork;
    if (typeof work.id !== "string" || work.anilist_id !== anilistId) throw new Error("invalid work");
    const spotsUrl = new URL(`${url}/rest/v1/verified_seichi_spots`);
    spotsUrl.searchParams.set("select", "id,work_id,name,region,latitude,longitude,source_url,coordinate_source_url,access_note,stay_minutes,closed_weekdays,closed_last_friday,notes");
    spotsUrl.searchParams.set("work_id", `eq.${work.id}`);
    spotsUrl.searchParams.set("order", "name.asc");
    const spotsResponse = await fetch(spotsUrl, { headers, cache: "no-store" });
    if (!spotsResponse.ok) throw new Error("spots unavailable");
    const spots: unknown = await spotsResponse.json();
    if (!Array.isArray(spots)) throw new Error("invalid spots response");
    if (spots.length === 0) return Response.json({ status: "unverified", work } satisfies AniListMatch);
    const verifiedSpots = spots as VerifiedSpot[];
    const spotIds = verifiedSpots.map((spot) => spot.id);
    if (spotIds.some((id) => !/^p_[a-z0-9]+$/.test(id))) throw new Error("invalid spot id");
    const metadataUrl = new URL(`${url}/rest/v1/verified_seichi_spots`);
    metadataUrl.searchParams.set("select", "id,relationship_note,entrance_note,official_url,source_checked_at,hours_status,opening_hours,last_admission,reservation_status,admission_yen,exceptional_closed_dates");
    metadataUrl.searchParams.set("id", `in.(${spotIds.join(",")})`);
    const metadataResponse = await fetch(metadataUrl, { headers, cache: "no-store" });
    if (metadataResponse.ok) {
      const metadata = await metadataResponse.json() as Array<Partial<VerifiedSpot> & { id: string }>;
      if (Array.isArray(metadata)) {
        const byId = new Map(metadata.map((item) => [item.id, item]));
        for (const spot of verifiedSpots) Object.assign(spot, byId.get(spot.id));
      }
    }
    const legsUrl = new URL(`${url}/rest/v1/verified_travel_legs`);
    legsUrl.searchParams.set("select", "from_spot_id,to_spot_id,mode,minutes,source_url");
    legsUrl.searchParams.set("from_spot_id", `in.(${spotIds.join(",")})`);
    legsUrl.searchParams.set("limit", "500");
    const legsResponse = await fetch(legsUrl, { headers, cache: "no-store" });
    if (!legsResponse.ok) throw new Error("legs unavailable");
    const legs: unknown = await legsResponse.json();
    if (!Array.isArray(legs)) throw new Error("invalid legs response");
    const ownIds = new Set(spotIds);
    const ownLegs = (legs as VerifiedLeg[]).filter((leg) => ownIds.has(leg.from_spot_id) && ownIds.has(leg.to_spot_id));
    return Response.json({ status: "ready", work, spots: verifiedSpots, legs: ownLegs } satisfies AniListMatch);
  } catch {
    return Response.json({ error: "作品DBとの照合に失敗しました。" }, { status: 503 });
  }
}
