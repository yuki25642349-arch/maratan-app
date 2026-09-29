import previewWorks from "./research-works-preview.json";
import previewSpots from "./research-spots-preview.json";
import oshiWakuSpots from "./oshiwaku-spots-preview.json";

export type ResearchWork = {
  id: string;
  title: string;
  category: string | null;
  version: string | null;
  regions: string[];
  spot_count: number;
  /** 地域ごとの掲載地点数（端末に同梱した調査データから集計） */
  region_counts: Record<string, number>;
};

export type ResearchCatalog = {
  works: ResearchWork[];
  error: boolean;
  source: "supabase" | "csv-preview";
};

const localSpotCount = new Map<string, number>();
const localRegionCounts = new Map<string, Record<string, number>>();
for (const spot of [...previewSpots, ...oshiWakuSpots]) {
  localSpotCount.set(spot.workId, (localSpotCount.get(spot.workId) ?? 0) + 1);
  const counts = localRegionCounts.get(spot.workId) ?? {};
  counts[spot.region] = (counts[spot.region] ?? 0) + 1;
  localRegionCounts.set(spot.workId, counts);
}

function withLocalCounts<T extends { id: string; spot_count: number }>(work: T): T & { region_counts: Record<string, number> } {
  return { ...work, spot_count: localSpotCount.get(work.id) ?? work.spot_count, region_counts: localRegionCounts.get(work.id) ?? {} };
}
const previewCatalog: ResearchCatalog = {
  works: previewWorks.map(withLocalCounts),
  error: false,
  source: "csv-preview",
};

export async function loadResearchWorks(): Promise<ResearchCatalog> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return { ...previewCatalog, error: true };

  try {
    const response = await fetch(
      `${url}/rest/v1/research_works?select=id,title,category,version,regions,spot_count&order=title.asc&limit=500`,
      { headers: { apikey: key }, cache: "no-store" },
    );
    if (!response.ok) return { ...previewCatalog, error: true };
    const data: unknown = await response.json();
    if (!Array.isArray(data)) return { ...previewCatalog, error: true };
    const works = data.filter((item): item is Omit<ResearchWork, "region_counts"> =>
      typeof item === "object" && item !== null &&
      typeof item.id === "string" && typeof item.title === "string" &&
      Array.isArray(item.regions) && item.regions.every((region: unknown) => typeof region === "string") &&
      typeof item.spot_count === "number" &&
      (item.category === null || typeof item.category === "string") &&
      (item.version === null || typeof item.version === "string"),
    );
    if (works.length === 0) return previewCatalog;
    const byId = new Map<string, ResearchWork>(previewCatalog.works.map((work) => [work.id, work]));
    for (const work of works) byId.set(work.id, withLocalCounts(work));
    return { works: [...byId.values()], error: false, source: "supabase" };
  } catch {
    return { ...previewCatalog, error: true };
  }
}
