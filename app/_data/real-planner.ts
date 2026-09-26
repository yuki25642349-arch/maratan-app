import type { VerifiedLeg, VerifiedSpot } from "./anilist-types";

export type VerifiedCourse = {
  stops: VerifiedSpot[];
  legs: VerifiedLeg[];
  stayMinutes: number;
  moveMinutes: number;
  bufferMinutes: number;
  totalMinutes: number;
};

export function isKnownClosed(spot: VerifiedSpot, date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const day = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== date) return false;
  if (spot.exceptional_closed_dates?.includes(date)) return true;
  const weekday = day.getUTCDay();
  if (spot.closed_weekdays.includes(weekday)) return true;
  if (spot.closed_last_friday && weekday === 5) {
    const nextFriday = new Date(day);
    nextFriday.setUTCDate(day.getUTCDate() + 7);
    return nextFriday.getUTCMonth() !== day.getUTCMonth();
  }
  return false;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length < 2) return [items];
  return items.flatMap((item, index) =>
    permutations(items.filter((_, otherIndex) => otherIndex !== index)).map((tail) => [item, ...tail]),
  );
}

export function planVerifiedCourse(stops: VerifiedSpot[], availableLegs: VerifiedLeg[]): VerifiedCourse | null {
  if (stops.length < 1 || stops.length > 3 || new Set(stops.map((spot) => spot.id)).size !== stops.length) return null;
  const legByPair = new Map(availableLegs.map((leg) => [`${leg.from_spot_id}/${leg.to_spot_id}`, leg]));
  const candidates = permutations(stops).flatMap((ordered) => {
    const legs = ordered.slice(0, -1).map((spot, index) => legByPair.get(`${spot.id}/${ordered[index + 1].id}`));
    if (legs.some((leg) => !leg)) return [];
    const completeLegs = legs as VerifiedLeg[];
    const stayMinutes = ordered.reduce((sum, spot) => sum + spot.stay_minutes, 0);
    const moveMinutes = completeLegs.reduce((sum, leg) => sum + leg.minutes, 0);
    const bufferMinutes = 20;
    return [{ stops: ordered, legs: completeLegs, stayMinutes, moveMinutes, bufferMinutes,
      totalMinutes: stayMinutes + moveMinutes + bufferMinutes }];
  });
  return candidates.sort((a, b) => a.moveMinutes - b.moveMinutes
    || a.stops.map((spot) => spot.id).join("/").localeCompare(b.stops.map((spot) => spot.id).join("/")))[0] ?? null;
}
