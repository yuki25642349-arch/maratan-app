export type ResearchWork = {
  id: string;
  title: string;
  category: string | null;
  version: string | null;
  regions: string[];
  spot_count: number;
};

export type ResearchCatalog = {
  works: ResearchWork[];
  error: boolean;
  source: "supabase" | "csv-preview";
};

const previewCatalog: ResearchCatalog = { works: previewWorks, error: false, source: "csv-preview" };

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
    const works = data.filter((item): item is ResearchWork =>
      typeof item === "object" && item !== null &&
      typeof item.id === "string" && typeof item.title === "string" &&
      Array.isArray(item.regions) && item.regions.every((region: unknown) => typeof region === "string") &&
      typeof item.spot_count === "number" &&
      (item.category === null || typeof item.category === "string") &&
      (item.version === null || typeof item.version === "string"),
    );
    if (works.length === 0) return previewCatalog;
    return { works, error: false, source: "supabase" };
  } catch {
    return { ...previewCatalog, error: true };
  }
}
import previewWorks from "./research-works-preview.json";
