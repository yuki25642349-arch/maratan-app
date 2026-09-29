import type { VerifiedSpot } from "./anilist-types";

// 地域の寄り道（食・文化）を Gemini と Google マップから取得するときの共通処理。
// 外部APIを呼ばない純粋な関数だけを置き、テストから直接読み込めるようにする。

export type DetourCategory = "food" | "shopping" | "culture" | "experience";

export type DetourSlot =
  | { kind: "between"; fromId: string; toId: string }
  | { kind: "near"; spotId: string };

export type PlacePeriod = { open?: { day?: number; hour?: number; minute?: number }; close?: { day?: number; hour?: number; minute?: number } };

/** Googleマップ グラウンディングの結果。aliases には Places API の日本語名などを入れる。 */
export type GroundedPlace = { placeId: string; title: string; uri: string; aliases?: string[] };

/** 「Ajidokoro Furukawa - Google Maps」の末尾の「 - Google Maps」を外す。 */
export function cleanGroundedTitle(title: string) {
  return title.replace(/\s*[-–—|｜]\s*Google\s*(?:Maps|マップ)\s*$/i, "").trim();
}

export const DETOUR_CATEGORY_LABELS: Record<DetourCategory, string> = {
  food: "地元の食",
  shopping: "地元の品",
  culture: "地域の文化",
  experience: "体験",
};

export const DEFAULT_DETOUR_STAY: Record<DetourCategory, number> = { food: 45, shopping: 20, culture: 40, experience: 60 };

/** 聖地のいずれかから、またはその間の直線から離れすぎた場所は寄り道として扱わない。 */
export const MAX_METERS_FROM_SEICHI = 3000;
export const MAX_METERS_FROM_SEGMENT = 1500;

const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;

/** `places/ChIJ...` と `ChIJ...` のどちらも受け付け、IDだけを返す。 */
export function normalizePlaceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.startsWith("places/") ? value.slice("places/".length) : value;
  return PLACE_ID.test(id) ? id : null;
}

export function isPlaceId(value: unknown): value is string {
  return typeof value === "string" && PLACE_ID.test(value);
}

const FOOD_TYPES = /restaurant|food|cafe|coffee|bakery|bar$|bar_|izakaya|ramen|sushi|soba|udon|confectionery|dessert|tea_house|diner|meal|brewery|winery|sake|market|deli|ice_cream/;
const SHOPPING_TYPES = /store|shop|market|gift|souvenir/;
const CULTURE_TYPES = /museum|gallery|shrine|temple|church|historical|monument|cultural|heritage|library|tourist_attraction|landmark|castle|performing_arts|art_studio/;
const EXPERIENCE_TYPES = /workshop|onsen|spa|hot_spring|farm|park|garden|craft|school|studio|sports|amusement/;

/** Places API の種別から寄り道のカテゴリを決める。AIの自己申告は使わない。 */
export function categoryFromTypes(primaryType: string | null | undefined, types: readonly string[] = []): DetourCategory {
  const all = [primaryType ?? "", ...types].filter(Boolean);
  const first = primaryType ?? "";
  if (first && FOOD_TYPES.test(first) && !/store$|supermarket/.test(first)) return "food";
  if (first && CULTURE_TYPES.test(first)) return "culture";
  if (first && EXPERIENCE_TYPES.test(first)) return "experience";
  if (first && SHOPPING_TYPES.test(first)) return "shopping";
  if (all.some((type) => FOOD_TYPES.test(type) && !/store$|supermarket/.test(type))) return "food";
  if (all.some((type) => CULTURE_TYPES.test(type))) return "culture";
  if (all.some((type) => EXPERIENCE_TYPES.test(type))) return "experience";
  if (all.some((type) => SHOPPING_TYPES.test(type))) return "shopping";
  return "culture";
}

/**
 * 通常営業時間から、1日も開かない曜日（0=日曜）を返す。
 * 営業時間が取得できないときは空配列（休業日不明）を返し、「毎日営業」とは扱わない。
 */
export function closedWeekdaysFromPeriods(periods: readonly PlacePeriod[] | null | undefined): number[] {
  if (!Array.isArray(periods) || !periods.length) return [];
  const openDays = new Set<number>();
  for (const period of periods) {
    const day = period.open?.day;
    if (!Number.isInteger(day) || day! < 0 || day! > 6) continue;
    // 24時間営業は「日曜0時に開き、閉店なし」で表される。
    if (!period.close && day === 0 && (period.open?.hour ?? 0) === 0 && (period.open?.minute ?? 0) === 0) return [];
    openDays.add(day!);
  }
  if (!openDays.size) return [];
  return [0, 1, 2, 3, 4, 5, 6].filter((day) => !openDays.has(day));
}

/** Googleマップの曜日別表示（月曜始まり）から、訪問日の曜日の行を取り出す。 */
export function openingHoursTextFor(weekdayDescriptions: readonly string[] | null | undefined, date: string): string | null {
  if (!Array.isArray(weekdayDescriptions) || weekdayDescriptions.length !== 7 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (Number.isNaN(day)) return null;
  const text = weekdayDescriptions[(day + 6) % 7];
  return typeof text === "string" && text.length <= 200 ? text : null;
}

type Point = { latitude: number; longitude: number };

export function metersBetween(a: Point, b: Point) {
  const radius = 6_371_000;
  const toRad = (value: number) => value * Math.PI / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 線分 a-b と点 p の距離（数km程度の範囲を想定した平面近似）。 */
export function metersFromSegment(p: Point, a: Point, b: Point) {
  const scale = Math.cos((a.latitude + b.latitude) / 2 * Math.PI / 180);
  const ax = a.longitude * scale, ay = a.latitude, bx = b.longitude * scale, by = b.latitude, px = p.longitude * scale, py = p.latitude;
  const length = (bx - ax) ** 2 + (by - ay) ** 2;
  const t = length ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / length)) : 0;
  return metersBetween(p, { latitude: ay + t * (by - ay), longitude: (ax + t * (bx - ax)) / scale });
}

/** 聖地の近く、または聖地と聖地の間にある場所だけを寄り道として残す。 */
export function isWithinReach(place: Point, seichi: readonly Point[]) {
  if (seichi.some((spot) => metersBetween(place, spot) <= MAX_METERS_FROM_SEICHI)) return true;
  for (let i = 0; i < seichi.length; i++) {
    for (let j = i + 1; j < seichi.length; j++) {
      if (metersFromSegment(place, seichi[i], seichi[j]) <= MAX_METERS_FROM_SEGMENT) return true;
    }
  }
  return false;
}

/**
 * 寄り道をどの聖地の区間に挟むと遠回りが少ないかを直線距離で判定する。
 * 聖地が2件以上なら必ず「間」（区間内）とし、聖地が1件のときだけ「前後」とする。
 */
export function suggestSlot(place: Point, seichi: readonly Pick<VerifiedSpot, "id" | "latitude" | "longitude">[]): DetourSlot | null {
  if (!seichi.length) return null;
  const nearest = [...seichi].sort((a, b) => metersBetween(place, a) - metersBetween(place, b))[0];
  let best: { cost: number; fromId: string; toId: string } | null = null;
  for (let i = 0; i < seichi.length; i++) {
    for (let j = i + 1; j < seichi.length; j++) {
      const a = seichi[i], b = seichi[j];
      const cost = metersBetween(a, place) + metersBetween(place, b) - metersBetween(a, b);
      if (!best || cost < best.cost) best = { cost, fromId: a.id, toId: b.id };
    }
  }
  if (best) return { kind: "between", fromId: best.fromId, toId: best.toId };
  return { kind: "near", spotId: nearest.id };
}

/** 聖地の区間に寄り道を挟んだときに増える直線距離（小さいほど区間の途中にある）。 */
export function intervalDetourCost(place: Point, seichi: readonly Point[]) {
  if (seichi.length < 2) return seichi.length ? metersBetween(place, seichi[0]) : 0;
  let best = Infinity;
  for (let i = 0; i < seichi.length; i++) {
    for (let j = i + 1; j < seichi.length; j++) {
      best = Math.min(best, metersBetween(seichi[i], place) + metersBetween(place, seichi[j]) - metersBetween(seichi[i], seichi[j]));
    }
  }
  return best;
}

function permute<T>(items: readonly T[]): T[][] {
  if (items.length < 2) return [[...items]];
  return items.flatMap((item, index) => permute(items.filter((_, other) => other !== index)).map((tail) => [item, ...tail]));
}

/**
 * 聖地を軸にした訪問順の候補。聖地の順番は変えず、寄り道は聖地と聖地の区間の中にだけ入れる。
 * 聖地が1件のときは、その前後に入れる。
 */
export function axisOrders(seichiOrder: readonly string[], detourIds: readonly string[]): string[][] {
  const all = [...seichiOrder, ...detourIds.filter((id) => !seichiOrder.includes(id))];
  const seichi = new Set(seichiOrder);
  return permute(all).filter((order) => {
    if (order.filter((id) => seichi.has(id)).join("\u0000") !== seichiOrder.join("\u0000")) return false;
    return seichiOrder.length < 2 || (order[0] === seichiOrder[0] && order[order.length - 1] === seichiOrder[seichiOrder.length - 1]);
  });
}

/**
 * 区間ごとの移動コスト（分や距離）が最も小さくなる、聖地を軸にした訪問順を返す。
 * コストが分からない区間を含む候補は使わない。どれも計算できなければ null。
 */
export function bestAxisOrder(seichiOrder: readonly string[], detourIds: readonly string[], cost: (from: string, to: string) => number | null): { order: string[]; cost: number } | null {
  let best: { order: string[]; cost: number } | null = null;
  for (const order of axisOrders(seichiOrder, detourIds)) {
    let total = 0;
    let complete = true;
    for (let i = 0; i < order.length - 1; i++) {
      const leg = cost(order[i], order[i + 1]);
      if (leg === null || !Number.isFinite(leg)) { complete = false; break; }
      total += leg;
    }
    if (complete && (!best || total < best.cost)) best = { order, cost: total };
  }
  return best;
}

export function slotLabel(slot: DetourSlot | null, names: Record<string, string>) {
  if (!slot) return null;
  if (slot.kind === "between") return `「${names[slot.fromId] ?? "聖地"}」と「${names[slot.toId] ?? "聖地"}」の間で寄りやすい場所です`;
  return `「${names[slot.spotId] ?? "聖地"}」の前後に寄りやすい場所です`;
}

/** 表記ゆれを吸収して店名を比べる。 */
export function normalizeName(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ja-JP").replace(/[\s・･·\-‐ー－()（）「」『』【】\[\]]/g, "");
}

/** Gemini の応答本文から JSON を取り出す。コードフェンスや前後の説明文があっても読む。 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.search(/[[{]/);
  if (start < 0) return null;
  const open = body[start];
  const end = body.lastIndexOf(open === "[" ? "]" : "}");
  if (end <= start) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
}

/** AIの紹介文のうち、営業・価格・予約などを断定しているものや長すぎるものは使わない。 */
export function safeDetourText(value: unknown, max = 120): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || [...text].length > max) return null;
  if (/https?:|www\.|営業中|開館中|必ず|確実|予約不要|予約なしで|\d+\s*円|\d{1,2}[:：時]\d{0,2}\s*(?:から|まで|〜|~)|定休|年中無休|作品に登場|聖地そのもの|ロケ地|モデル地/.test(text)) return null;
  return text;
}

export type GeminiDetourPick = { name: string; localFeature: string; reason: string; placeId: string | null };

/**
 * Gemini の候補を、Googleマップの根拠（grounding）に含まれる場所だけに絞る。
 * 根拠のない店名・施設名は AI の創作とみなして捨てる。
 */
export function matchGroundedPicks(raw: unknown, grounded: readonly GroundedPlace[]): Array<GeminiDetourPick & { placeId: string; mapsUri: string }> {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { places?: unknown }).places) ? (raw as { places: unknown[] }).places : [];
  const byId = new Map(grounded.map((place) => [place.placeId, place]));
  const names = grounded.map((place) => ({ place, keys: [place.title, ...(place.aliases ?? [])].map((name) => normalizeName(cleanGroundedTitle(name))).filter(Boolean) }));
  const results: Array<GeminiDetourPick & { placeId: string; mapsUri: string }> = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Record<string, unknown>;
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    const localFeature = safeDetourText(candidate.localFeature, 60);
    const reason = safeDetourText(candidate.reason, 120);
    if (!name || !localFeature || !reason) continue;
    const idHint = normalizePlaceId(candidate.placeId);
    const key = normalizeName(name);
    const match = (idHint && byId.get(idHint)) || names.find((item) => item.keys.includes(key))?.place
      || names.find((item) => key.length >= 3 && item.keys.some((title) => title.length >= 3 && (title.includes(key) || key.includes(title))))?.place;
    if (!match || seen.has(match.placeId)) continue;
    seen.add(match.placeId);
    results.push({ name: match.aliases?.[0] ?? cleanGroundedTitle(match.title), localFeature, reason, placeId: match.placeId, mapsUri: match.uri });
  }
  return results;
}

/** Googleマップへのリンクだけを許可する。 */
export function safeMapsUri(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (!/^(?:maps\.google\.com|www\.google\.com|google\.com|maps\.app\.goo\.gl|goo\.gl)$/.test(url.hostname)) return null;
    return url.toString();
  } catch { return null; }
}

/** 位置検索の結果が同じ地域にまとまっているものだけを残す（別の県の同名地点などを除く）。 */
export function consistentAnchors<T extends Point>(anchors: readonly T[], maxMeters = 40_000): T[] {
  if (anchors.length < 2) return [...anchors];
  const scores = anchors.map((anchor) => anchors.filter((other) => metersBetween(anchor, other) <= maxMeters).length);
  const best = Math.max(...scores);
  // どれも離れているときは、最初に選んだ地点だけを基準にする。
  if (best < 2) return [anchors[0]];
  return anchors.filter((_, index) => scores[index] === best);
}

/**
 * 聖地の訪問順に寄り道を差し込む。
 * 「AとBの間」は2つが隣り合っていればその間に、「Aの前後」はAが先頭なら前、それ以外は後ろに入れる。
 * 聖地の順番そのものは変えない。
 */
export function insertDetours(seichiOrder: readonly string[], detours: ReadonlyArray<{ id: string; detour_slot?: DetourSlot | null }>): string[] {
  const result = [...seichiOrder];
  for (const detour of detours) {
    if (result.includes(detour.id)) continue;
    const slot = detour.detour_slot;
    const a = slot?.kind === "between" ? seichiOrder.indexOf(slot.fromId) : -1;
    const b = slot?.kind === "between" ? seichiOrder.indexOf(slot.toId) : -1;
    if (a >= 0 && b >= 0 && Math.abs(a - b) === 1) {
      const later = seichiOrder[Math.max(a, b)];
      result.splice(result.indexOf(later), 0, detour.id);
      continue;
    }
    const anchor = slot?.kind === "near" ? slot.spotId : slot?.kind === "between" ? (a >= 0 ? slot.fromId : slot.toId) : null;
    const position = anchor ? result.indexOf(anchor) : -1;
    if (position < 0) result.push(detour.id);
    else if (seichiOrder.length > 1 && anchor === seichiOrder[0]) result.splice(position, 0, detour.id);
    else result.splice(position + 1, 0, detour.id);
  }
  return result;
}
