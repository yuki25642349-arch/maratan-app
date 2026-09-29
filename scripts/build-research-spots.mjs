import { readFile, writeFile } from "node:fs/promises";

const input = process.argv[2];
if (!input) throw new Error("使い方: node scripts/build-research-spots.mjs <調査CSVのパス>");

function parseCsv(source) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (char !== "\r") cell += char;
  }
  if (quoted) throw new Error("CSVの引用符が閉じていません。");
  if (row.length || cell) { row.push(cell); rows.push(row); }
  return rows;
}

const rows = parseCsv((await readFile(input, "utf8")).replace(/^\uFEFF/, ""));
const header = rows.shift();
if (!header) throw new Error("CSVが空です。");
const required = ["レコードID", "作品ID", "地点ID", "作品名", "地点名", "都道府県", "市区町村等", "地点粒度", "出典URL", "出典確認段階"];
for (const name of required) if (!header.includes(name)) throw new Error(`不足している列: ${name}`);
const indexByName = new Map(header.map((name, index) => [name, index]));
const spots = rows.map((row, index) => {
  if (row.length !== header.length) throw new Error(`${index + 2}行目の列数が違います。`);
  const get = (name) => row[indexByName.get(name)]?.trim() ?? "";
  const sourceUrl = get("出典URL");
  if (!/^https:\/\//.test(sourceUrl)) throw new Error(`${index + 2}行目の出典URLが不正です。`);
  return {
    id: get("レコードID"),
    workId: get("作品ID"),
    name: get("地点名"),
    region: [get("都道府県"), get("市区町村等")].filter(Boolean).join("・"),
    granularity: get("地点粒度"),
    relationship: get("作品との関係"),
    sourceUrl,
    sourceStage: get("出典確認段階"),
  };
});
if (new Set(spots.map((spot) => spot.id)).size !== spots.length) throw new Error("レコードIDが重複しています。");
await writeFile(new URL("../app/_data/research-spots-preview.json", import.meta.url), `${JSON.stringify(spots, null, 2)}\n`);
console.log(`${new Set(spots.map((spot) => spot.workId)).size}作品、${spots.length}地点を書き出しました。`);
