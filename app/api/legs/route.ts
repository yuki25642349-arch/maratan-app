import { computeLeg, type LegResult } from "../../_data/google-routes";
import { isPlaceId } from "../../_data/local-detours";

export const runtime = "nodejs";

// 移動時間を登録していない地域の訪問順の案で、隣り合う地点ごとに徒歩とバス・電車の分数を調べる。
// 地点は Google の Place ID（聖地の位置検索・寄り道の結果）で受け取り、座標は受け取らない。

type Input = { placeIds: string[]; visitDate: string };

const requestTimes = new Map<string, number[]>();
const LIMIT_PER_MINUTE = 10;

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
  if (!Array.isArray(item.placeIds) || item.placeIds.length < 2 || item.placeIds.length > 5 || !item.placeIds.every(isPlaceId)) return null;
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
  if (!input) return Response.json({ error: "地点と訪問日を確認してください。" }, { status: 400 });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) return Response.json({ error: "移動時間の計算回数が多いため、少し待って再試行してください。" }, { status: 429 });
  const key = process.env.GOOGLE_ROUTES_API_KEY;
  if (!key) return Response.json({ error: "移動時間を計算する設定がありません。" }, { status: 503 });
  const legs: Array<LegResult | null> = await Promise.all(input.placeIds.slice(0, -1).map((placeId, index) =>
    computeLeg({ placeId }, { placeId: input.placeIds[index + 1] }, input.visitDate, key)));
  return Response.json({ legs }, { headers: { "Cache-Control": "no-store" } });
}
