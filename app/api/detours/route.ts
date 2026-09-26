import type { VerifiedDetour } from "../../_data/anilist-types";

export async function GET(request: Request) {
  const region = new URL(request.url).searchParams.get("region") ?? "";
  if (!region || region.length > 80) return Response.json({ error: "地域が不正です。" }, { status: 400 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return Response.json({ error: "地点DBの設定がありません。" }, { status: 503 });
  try {
    const endpoint = new URL(`${url}/rest/v1/verified_local_detours`);
    endpoint.searchParams.set("select", "id,name,region,category,latitude,longitude,entrance_note,local_relevance,source_url,official_url,stay_minutes,access_note,closed_weekdays,exceptional_closed_dates,hours_status,last_admission,reservation_status,reference_price_yen");
    endpoint.searchParams.set("region", `eq.${region}`);
    endpoint.searchParams.set("order", "name.asc");
    endpoint.searchParams.set("limit", "100");
    const response = await fetch(endpoint, { headers: { apikey: key }, cache: "no-store" });
    if (!response.ok) {
      const failure: unknown = await response.json().catch(() => null);
      if (response.status === 404 && (failure as { code?: unknown } | null)?.code === "PGRST205") {
        return Response.json({ detours: [], available: false }, { headers: { "Cache-Control": "no-store" } });
      }
      throw new Error("detours unavailable");
    }
    const rows = await response.json() as Array<Record<string, unknown>>;
    if (!Array.isArray(rows)) throw new Error("invalid detours");
    const detours: VerifiedDetour[] = rows.map((row) => ({
      id: String(row.id), work_id: "", name: String(row.name), region: String(row.region),
      latitude: Number(row.latitude), longitude: Number(row.longitude), source_url: String(row.source_url),
      coordinate_source_url: null, access_note: String(row.access_note ?? ""), stay_minutes: Number(row.stay_minutes),
      closed_weekdays: Array.isArray(row.closed_weekdays) ? row.closed_weekdays as number[] : [], closed_last_friday: false,
      notes: String(row.local_relevance ?? ""), kind: "detour", category: String(row.category),
      local_relevance: String(row.local_relevance), exceptional_closed_dates: Array.isArray(row.exceptional_closed_dates) ? row.exceptional_closed_dates as string[] : [],
      official_url: typeof row.official_url === "string" ? row.official_url : null,
      hours_status: row.hours_status === "no_hours" || row.hours_status === "hours_known" ? row.hours_status : "unknown",
      last_admission: typeof row.last_admission === "string" ? row.last_admission : null,
      reservation_status: row.reservation_status === "required" || row.reservation_status === "not_required" ? row.reservation_status : "unknown",
      reference_price_yen: typeof row.reference_price_yen === "number" ? row.reference_price_yen : null,
    }));
    return Response.json({ detours, available: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "寄り道候補を取得できません。DBの更新状況を確認してください。" }, { status: 503 });
  }
}
