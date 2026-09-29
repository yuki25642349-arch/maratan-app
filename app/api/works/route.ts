import type { MatchedWork, VerifiedSpot } from "../../_data/anilist-types";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length > 80) return Response.json({ error: "検索語が長すぎます。" }, { status: 400 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return Response.json({ error: "作品DBの設定がありません。" }, { status: 503 });
  try {
    const headers = { apikey: key };
    const [worksResponse, spotsResponse] = await Promise.all([
      fetch(`${url}/rest/v1/research_works?select=id,title,version,regions,anilist_id,category&limit=500`, { headers, cache: "no-store" }),
      fetch(`${url}/rest/v1/verified_seichi_spots?select=id,work_id,region&limit=1000`, { headers, cache: "no-store" }),
    ]);
    if (!worksResponse.ok || !spotsResponse.ok) throw new Error("DB unavailable");
    const works = await worksResponse.json() as (MatchedWork & { category: string | null })[];
    const spots = await spotsResponse.json() as Pick<VerifiedSpot, "id" | "work_id" | "region">[];
    if (!Array.isArray(works) || !Array.isArray(spots)) throw new Error("Invalid DB response");
    const regionsByWork = new Map<string, Record<string, number>>();
    for (const spot of spots) {
      if (!spot.work_id || !spot.region) continue;
      const counts = regionsByWork.get(spot.work_id) ?? {};
      counts[spot.region] = (counts[spot.region] ?? 0) + 1;
      regionsByWork.set(spot.work_id, counts);
    }
    const normalized = query.normalize("NFKC").toLocaleLowerCase("ja-JP").replace(/\s+/g, "");
    const published = works.filter((work) => regionsByWork.has(work.id)).map((work) => ({
      ...work, regions: Object.keys(regionsByWork.get(work.id) ?? {}), spotCounts: regionsByWork.get(work.id) ?? {},
    })).filter((work) => `${work.title}${work.regions.join("")}`.normalize("NFKC").toLocaleLowerCase("ja-JP").replace(/\s+/g, "").includes(normalized));
    return Response.json({ works: published }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "対応作品を取得できませんでした。" }, { status: 503 });
  }
}
