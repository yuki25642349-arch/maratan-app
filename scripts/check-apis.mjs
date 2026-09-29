// 外部APIが実際に使えるかを確かめる。`npm run check:apis` で実行する。
// .env.local と .env を読み、キーの値は表示しない。
import { existsSync, readFileSync } from "node:fs";

for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

const env = process.env;
const placesKey = env.GOOGLE_PLACES_API_KEY || env.GOOGLE_ROUTES_API_KEY;
// 飛騨古川駅と飛騨市図書館（「君の名は。」の確認済み地点付近）
const station = { latitude: 36.2372, longitude: 137.1895 };
const library = { latitude: 36.2381, longitude: 137.1866 };
let failures = 0;

async function check(name, required, run) {
  if (!required.every((key) => env[key])) {
    console.log(`－ ${name}: 未設定（${required.join(" / ")}）`);
    failures++;
    return;
  }
  try {
    const detail = await run();
    console.log(`✅ ${name}: ${detail}`);
  } catch (error) {
    console.log(`❌ ${name}: ${error instanceof Error ? error.message : error}`);
    failures++;
  }
}

async function json(response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`HTTP ${response.status} ${body?.error?.message ?? body?.message ?? ""}`.trim());
  return body;
}

await check("Supabase（作品・聖地DB）", ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"], async () => {
  const rows = await json(await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/verified_seichi_spots?select=id&limit=1000`, { headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY } }));
  return `確認済み聖地 ${rows.length} 件`;
});

await check("Places API (New)（寄り道の確認・地点の位置）", placesKey ? [] : ["GOOGLE_PLACES_API_KEY"], async () => {
  const data = await json(await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": placesKey, "X-Goog-FieldMask": "places.id,places.displayName,places.reviewSummary" },
    body: JSON.stringify({ textQuery: "岐阜県 飛騨市 郷土料理", languageCode: "ja", regionCode: "JP", maxResultCount: 5 }),
  }));
  const places = data.places ?? [];
  const summarized = places.filter((place) => place.reviewSummary?.text?.text);
  return `「飛騨市 郷土料理」で ${places.length} 件（例：${places[0]?.displayName?.text ?? "なし"}）／AIクチコミ要約あり ${summarized.length} 件${summarized[0] ? `（例：${summarized[0].displayName?.text}「${summarized[0].reviewSummary.text.text.slice(0, 30)}…」）` : ""}`;
});

await check("Routes API（地点間の移動時間）", ["GOOGLE_ROUTES_API_KEY"], async () => {
  const data = await json(await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": env.GOOGLE_ROUTES_API_KEY, "X-Goog-FieldMask": "routes.duration" },
    body: JSON.stringify({ origin: { location: { latLng: library } }, destination: { location: { latLng: station } }, travelMode: "WALK", languageCode: "ja-JP" }),
  }));
  return `図書館→駅 徒歩 ${data.routes?.[0]?.duration ?? "経路なし"}`;
});

/** Google から返ったエラー文を短く取り出す（キーの値は含まれない）。 */
async function reason(response) {
  const body = await response.json().catch(() => null);
  const message = body?.error?.message ? String(body.error.message).replace(/\s+/g, " ").slice(0, 160) : "";
  return `HTTP ${response.status}${body?.error?.status ? ` ${body.error.status}` : ""}${message ? `（${message}）` : ""}`;
}

let groundingOk = false;
await check("Gemini + Googleマップ グラウンディング（寄り道探し）", ["GEMINI_API_KEY"], async () => {
  const models = [...new Set([env.GEMINI_DETOUR_MODEL, "gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"].filter(Boolean))];
  const errors = [];
  for (const model of models) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "飛騨古川駅の近くで、飛騨の郷土料理を食べられるお店を2件、Googleマップで探して名前だけ答えてください。" }] }],
        tools: [{ googleMaps: {} }],
        toolConfig: { retrievalConfig: { latLng: station, languageCode: "ja" } },
      }),
    });
    if (!response.ok) { errors.push(`${model}: ${await reason(response)}`); continue; }
    const data = await response.json();
    const chunks = (data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []).filter((chunk) => chunk.maps?.placeId);
    if (!chunks.length) { errors.push(`${model}: Googleマップの根拠が返りませんでした`); continue; }
    groundingOk = true;
    return `${model} で ${chunks.length} 件（例：${chunks[0].maps.title.replace(/\s*[-–—|｜]\s*Google\s*(?:Maps|マップ)\s*$/i, "")}）${model !== models[0] ? `／先に試したモデルは失敗：${errors.join("、")}` : ""}`;
  }
  throw new Error(errors.join("\n   "));
});

// グラウンディングが使えなくても、Places の検索結果に Gemini が紹介文を付ける予備の方法で寄り道を出せる。
await check("Gemini（紹介文・おすすめコースの選択）", ["GEMINI_API_KEY"], async () => {
  const model = env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "「飛騨の郷土料理」を10文字以内で説明してください。" }] }] }),
  });
  if (!response.ok) throw new Error(`${model}: ${await reason(response)}`);
  return `${model} に接続できました`;
});

if (!groundingOk && placesKey) console.log("\n※ Googleマップ グラウンディングが使えない間も、寄り道は「Places の検索＋Gemini の紹介文」で探します（上の Gemini と Places が ✅ なら動きます）。\n  グラウンディングを使うには、Google AI Studio で課金（Paid tier）を有効にしてください。");
console.log(failures ? `\n${failures} 件の確認に失敗しました。README の「環境変数」を確認してください。` : "\nすべての外部APIに接続できました。");
process.exitCode = failures ? 1 : 0;
