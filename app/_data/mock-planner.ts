import type { Detour, Spot } from "./mock-data";

export type MockScenario = "normal" | "missing_data" | "route_error";
export type CourseStatus = "目安では収まる" | "要確認" | "目安でも収まらない" | "計算できない" | "休業日";
export type Stop = {
  id: string;
  name: string;
  kind: "sacred" | "detour";
  stayMinutes: number;
  hours: string;
  lastEntry: string;
  fee: number | null;
  reservation: string;
  sourceLabel: string;
  sourceDate: string;
  officialUrl: string;
  note: string;
  mapX: number;
  mapY: number;
  closedWeekdays?: number[];
  exceptionalClosedDates?: string[];
};
export type Leg = {
  from: Stop;
  to: Stop;
  mode: "walking" | "transit";
  minutes: number | null;
  walkingMeters: number | null;
  fare: number | null;
};
export type Candidate = { id: string; stops: Stop[]; legs: Leg[]; moveMinutes: number | null };
export type Course = {
  candidates: Candidate[];
  candidate: Candidate;
  status: CourseStatus;
  reasons: string[];
  stayMinutes: number;
  moveMinutes: number | null;
  bufferMinutes: number;
  totalMinutes: number | null;
  difference: number | null;
  facilityCost: number;
  detourCost: number;
  transportCost: number;
  unknownCosts: string[];
  blockedByClosure: boolean;
};

export function limitDetoursForSacredSpots(sacredCount: number, detourIds: string[], maxStops = 5) {
  const keepCount = Math.max(0, maxStops - sacredCount);
  return { kept: detourIds.slice(0, keepCount), removed: detourIds.slice(keepCount) };
}

type ClosablePlace = { closedWeekdays?: number[]; exceptionalClosedDates?: string[] };

export function isClosedOnDate(place: ClosablePlace, date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return place.closedWeekdays?.includes(weekday) === true || place.exceptionalClosedDates?.includes(date) === true;
}

export function nextOpenDate(places: ClosablePlace[], date: string): string | null {
  const initial = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(initial.getTime())) return null;
  for (let offset = 1; offset <= 366; offset += 1) {
    const next = new Date(initial);
    next.setUTCDate(next.getUTCDate() + offset);
    const candidate = next.toISOString().slice(0, 10);
    if (places.every((place) => !isClosedOnDate(place, candidate))) return candidate;
  }
  return null;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length < 2) return [items];
  return items.flatMap((item, index) =>
    permutations(items.filter((_, itemIndex) => itemIndex !== index)).map((tail) => [item, ...tail]),
  );
}

function legFor(from: Stop, to: Stop): Leg {
  // 画面上の仮座標から作るデモ値。実距離・時刻表・運賃ではない。
  const mockMeters = Math.round(Math.hypot(from.mapX - to.mapX, from.mapY - to.mapY) * 35 / 50) * 50;
  if (mockMeters <= 1400) {
    return { from, to, mode: "walking", minutes: Math.max(4, Math.round(mockMeters / 75)), walkingMeters: mockMeters, fare: 0 };
  }
  return { from, to, mode: "transit", minutes: Math.max(12, Math.round(mockMeters / 180) + 7), walkingMeters: 300, fare: 220 };
}

function toStops(spots: Spot[], detours: Detour[], durations: Record<string, number>): Stop[] {
  return [
    ...spots.map((spot): Stop => ({
      id: spot.id, name: spot.name, kind: "sacred", stayMinutes: durations[spot.id] ?? spot.stayMinutes,
      hours: spot.hours, lastEntry: spot.lastEntry, fee: spot.fee, reservation: spot.reservation,
      sourceLabel: spot.sourceLabel, sourceDate: spot.sourceDate, officialUrl: spot.officialUrl,
      note: spot.relation, mapX: spot.mapX, mapY: spot.mapY,
      closedWeekdays: spot.closedWeekdays, exceptionalClosedDates: spot.exceptionalClosedDates,
    })),
    ...detours.map((detour): Stop => ({
      id: detour.id, name: detour.name, kind: "detour", stayMinutes: detour.stayMinutes,
      hours: detour.hours, lastEntry: detour.lastEntry, fee: detour.price, reservation: detour.reservation,
      sourceLabel: detour.sourceLabel, sourceDate: detour.sourceDate, officialUrl: detour.officialUrl,
      note: detour.description, mapX: detour.mapX, mapY: detour.mapY,
      closedWeekdays: detour.closedWeekdays, exceptionalClosedDates: detour.exceptionalClosedDates,
    })),
  ];
}

export function makeCandidates(spots: Spot[], detours: Detour[], durations: Record<string, number>): Candidate[] {
  const allStops = toStops(spots, detours, durations);
  if (!allStops.length || allStops.length > 5) return [];
  return permutations(allStops).map((stops) => {
    const legs = stops.slice(0, -1).map((stop, index) => legFor(stop, stops[index + 1]));
    return { id: stops.map((stop) => stop.id).join("/"), stops, legs, moveMinutes: legs.reduce((sum, leg) => sum + (leg.minutes ?? 0), 0) };
  }).sort((a, b) =>
    (a.moveMinutes ?? 0) - (b.moveMinutes ?? 0)
    || Number(b.stops[0].kind === "sacred") - Number(a.stops[0].kind === "sacred")
    || a.id.localeCompare(b.id, "ja"),
  );
}

export function evaluateCourse(
  candidate: Candidate,
  date: string,
  availableMinutes: number,
  scenario: MockScenario,
  candidates: Candidate[],
): Course {
  const reasons: string[] = [];
  const stops = candidate.stops;
  const closed = stops.filter((stop) => isClosedOnDate(stop, date));
  closed.forEach((stop) => reasons.push(`${stop.name}は選択日の登録済み休業日です。`));
  stops.filter((stop) => !stop.hours.includes("営業時間なし") && stop.lastEntry !== "なし").forEach((stop) => {
    reasons.push(`${stop.name}の営業時間・最終入場は訪問時刻を決めていないため要確認です。`);
  });
  stops.filter((stop) => stop.reservation !== "不要").forEach((stop) => reasons.push(`${stop.name}：${stop.reservation}。`));
  const legs = candidate.legs.map((leg, index) => {
    if (scenario === "route_error" && index === 0) return { ...leg, minutes: null, walkingMeters: null, fare: leg.mode === "walking" ? 0 : null };
    if (scenario === "missing_data" && index === 0 && leg.mode === "transit") return { ...leg, fare: null };
    return leg;
  });
  if (scenario === "missing_data") reasons.push("デモ設定：営業情報が未取得です。公共交通区間がある場合は運賃も未取得です。");
  if (scenario === "route_error") reasons.unshift(legs.length ? "デモ設定：主要区間の経路が取得できませんでした。訪問不可能という意味ではありません。条件を変えて再確認してください。" : "デモ設定：地点データの確認に失敗しました。訪問不可能という意味ではありません。条件を変えて再確認してください。");
  const moveMinutes = legs.some((leg) => leg.minutes === null) || scenario === "route_error"
    ? null : legs.reduce((sum, leg) => sum + (leg.minutes ?? 0), 0);
  const stayMinutes = stops.reduce((sum, stop) => sum + stop.stayMinutes, 0);
  const bufferMinutes = 20;
  const totalMinutes = moveMinutes === null ? null : stayMinutes + moveMinutes + bufferMinutes;
  const difference = totalMinutes === null ? null : availableMinutes - totalMinutes;
  if (difference !== null && difference < 0) reasons.unshift(`指定した周遊時間を約${Math.abs(difference)}分超えます。`);
  else if (difference !== null && difference < 30) reasons.push(`時間の余裕が約${difference}分と少なめです。`);
  const unknownCosts: string[] = [];
  stops.filter((stop) => stop.fee === null).forEach((stop) => unknownCosts.push(`${stop.name}の料金`));
  legs.filter((leg) => leg.fare === null).forEach((leg) => unknownCosts.push(`${leg.from.name}→${leg.to.name}の運賃`));
  if (unknownCosts.length) reasons.push(`費用未取得：${unknownCosts.join("、")}。`);
  const status: CourseStatus = closed.length ? "休業日"
    : moveMinutes === null ? "計算できない"
    : difference !== null && difference < 0 ? "目安でも収まらない"
    : reasons.length ? "要確認" : "目安では収まる";
  if (status === "目安では収まる") reasons.push("取得できたデモ区間の概算は指定時間内です。帰りの便や帰着は判定していません。");
  return {
    candidates, candidate: { ...candidate, legs, moveMinutes }, status, reasons,
    stayMinutes, moveMinutes, bufferMinutes, totalMinutes, difference,
    facilityCost: stops.filter((stop) => stop.kind === "sacred").reduce((sum, stop) => sum + (stop.fee ?? 0), 0),
    detourCost: stops.filter((stop) => stop.kind === "detour").reduce((sum, stop) => sum + (stop.fee ?? 0), 0),
    transportCost: legs.reduce((sum, leg) => sum + (leg.fare ?? 0), 0), unknownCosts,
    blockedByClosure: closed.length > 0,
  };
}
