// 「食・お店から探す」で使う判定（ブラウザ・サーバー・テスト共用、外部APIは呼ばない）。

export type DetourCategoryName = "food" | "shopping" | "culture" | "experience";

const CATEGORY_WORDS: Array<[RegExp, DetourCategoryName]> = [
  [/^(食|食べ物|グルメ|ごはん|ご飯|料理|郷土料理|ランチ)$/, "food"],
  [/^(買う|買い物|お土産|おみやげ|土産|特産品|名産品)$/, "shopping"],
  [/^(文化|歴史|伝統|伝統工芸|工芸)$/, "culture"],
  [/^(体験)$/, "experience"],
];

/** 「食」「お土産」などカテゴリそのものを表す言葉なら、そのカテゴリを返す。 */
export function categoryForWord(word: string): DetourCategoryName | null {
  const text = word.normalize("NFKC").trim();
  return CATEGORY_WORDS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

/** 「岩手県・久慈市」→ { prefecture: "岩手県", city: "久慈市" } */
export function splitRegion(region: string) {
  const [prefecture, city = ""] = region.split("・");
  return { prefecture: prefecture.trim(), city: city.trim() };
}

function compact(text: string) {
  return text.normalize("NFKC").replace(/\s+/g, "");
}

/** Google の住所がその地域（都道府県と市区町村）の中かどうか。 */
export function addressInRegion(address: string | null | undefined, region: string) {
  if (!address) return false;
  const { prefecture, city } = splitRegion(region);
  const text = compact(address);
  return Boolean(prefecture) && text.includes(compact(prefecture)) && (!city || text.includes(compact(city)));
}

/** キーワードが地域名そのもの（「飛騨」「久慈市」など）なら、その地域を返す。 */
export function regionsMatchingText(query: string, regions: readonly string[]) {
  const text = compact(query).replace(/[都道府県市区町村]$/, "");
  if (text.length < 2) return [];
  return regions.filter((region) => {
    const { prefecture, city } = splitRegion(region);
    return compact(city).startsWith(text) || compact(prefecture).startsWith(text);
  });
}

/** AI が選んだ地域のうち、アプリで扱っている地域だけを残す（創作された地域名は捨てる）。 */
export function pickKnownRegions(raw: unknown, regions: readonly string[], max = 4) {
  const known = new Set(regions);
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { regions?: unknown }).regions) ? (raw as { regions: unknown[] }).regions : [];
  return [...new Set(list.filter((item): item is string => typeof item === "string" && known.has(item.trim())).map((item) => item.trim()))].slice(0, max);
}

/** 検索語を Google や DB の検索に安全に渡せる形にする。 */
export function cleanQuery(query: string) {
  return query.normalize("NFKC").replace(/[,()*%\\"'.:;]/g, " ").replace(/\s+/g, " ").trim();
}
