import { readFile, writeFile } from "node:fs/promises";

const works = JSON.parse(await readFile(new URL("../app/_data/research-works-preview.json", import.meta.url), "utf8"));
const csvSpots = JSON.parse(await readFile(new URL("../app/_data/research-spots-preview.json", import.meta.url), "utf8"));
const supportedRegions = new Set([
  "秒速5センチメートル|栃木県・栃木市",
  "らき☆すた|埼玉県・久喜市",
  "花咲くいろは|石川県・金沢市",
  "サマーウォーズ|長野県・上田市",
  "君の名は。|岐阜県・飛騨市",
  "けいおん！|滋賀県・豊郷町",
  "君の膵臓をたべたい|福岡県・福岡市",
  "君の膵臓をたべたい|福岡県・太宰府市",
]);
const response = await fetch("https://api.oshiwaku.net/api/seichi/spots?category=anime_location");
if (!response.ok) throw new Error(`推しワクのスポット取得に失敗: ${response.status}`);
const payload = await response.json();
if (!payload.success || !Array.isArray(payload.data?.spots)) throw new Error("推しワクの応答形式が不正です。");

const supplement = [];
for (const spot of payload.data.spots) {
  if (spot.category !== "anime_location" || !spot.artist_name || !spot.name || !spot.address || !spot.slug) continue;
  if (spot.verified !== false && spot.verified !== true) continue;
  for (const work of works.filter((item) => item.title === spot.artist_name)) {
    for (const region of work.regions) {
      if (!supportedRegions.has(`${work.title}|${region}`)) continue;
      const [prefecture, municipality] = region.split("・");
      if (!spot.address.includes(prefecture) || !spot.address.includes(municipality)) continue;
      if (csvSpots.some((item) => item.workId === work.id && item.region === region && item.name === spot.name)) continue;
      const listingUrl = `https://oshiwaku.net/seichi/${spot.slug}`;
      const sourceUrl = typeof spot.source_url === "string" && spot.source_url.startsWith("https://") ? spot.source_url : listingUrl;
      supplement.push({
        id: `oshi_${spot.slug}`,
        workId: work.id,
        name: spot.name,
        region,
        granularity: "地点",
        relationship: "聖地巡礼候補",
        sourceUrl,
        listingUrl,
        sourceStage: "推しワク掲載・現地未確認",
      });
    }
  }
}
if (new Set(supplement.map((spot) => spot.id)).size !== supplement.length) throw new Error("補完地点IDが重複しています。");
await writeFile(new URL("../app/_data/oshiwaku-spots-preview.json", import.meta.url), `${JSON.stringify(supplement, null, 2)}\n`);
console.log(`推しワクから${supplement.length}地点を補完しました。`);
