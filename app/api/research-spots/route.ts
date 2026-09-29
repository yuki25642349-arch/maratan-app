import { researchSpotsForWork } from "../../_data/research-spots";

export async function GET(request: Request) {
  const workId = new URL(request.url).searchParams.get("workId") ?? "";
  if (!/^w_[a-z0-9]+$/.test(workId)) {
    return Response.json({ error: "作品IDが不正です。" }, { status: 400 });
  }
  return Response.json({ spots: researchSpotsForWork(workId) }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
