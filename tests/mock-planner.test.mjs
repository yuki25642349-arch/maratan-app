import assert from "node:assert/strict";
import test from "node:test";
import { spots, detours } from "../app/_data/mock-data.ts";
import { evaluateCourse, isClosedOnDate, limitDetoursForSacredSpots, makeCandidates, nextOpenDate } from "../app/_data/mock-planner.ts";

const crossing = spots.find((spot) => spot.id === "crossing");
const viewpoint = spots.find((spot) => spot.id === "viewpoint");
const clocktower = spots.find((spot) => spot.id === "clocktower");
const shirasu = detours.find((detour) => detour.id === "shirasu");

test("聖地を増やしたときは後から選んだ寄り道を外して5件以内にする", () => {
  assert.deepEqual(limitDetoursForSacredSpots(3, ["shirasu", "craft", "market"]), {
    kept: ["shirasu", "craft"],
    removed: ["market"],
  });
});

test("候補は最大5地点まで、必須聖地を全て含む", () => {
  const candidates = makeCandidates([crossing, viewpoint, clocktower], detours.filter((detour) => ["shirasu", "craft"].includes(detour.id)), {});
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every((candidate) => candidate.stops.length === 5));
  assert.ok(candidates.every((candidate) => ["crossing", "viewpoint", "clocktower"].every((id) => candidate.stops.some((stop) => stop.id === id))));
  assert.deepEqual(makeCandidates([crossing, viewpoint, clocktower], detours.filter((detour) => detour.regionId === "kamakura"), {}), []);
});

test("同じ移動時間なら聖地から始まる順を先に表示する", () => {
  const candidates = makeCandidates([crossing], [shirasu], {});
  assert.equal(candidates[0].moveMinutes, candidates[1].moveMinutes);
  assert.equal(candidates[0].stops[0].kind, "sacred");
});

test("登録済み休業日をコース作成前に検出し、次に巡れる日を示す", () => {
  assert.equal(isClosedOnDate(clocktower, "2026-09-30"), true);
  assert.equal(isClosedOnDate(clocktower, "2026-10-01"), false);
  assert.equal(isClosedOnDate(viewpoint, "2026-10-20"), true);
  assert.equal(isClosedOnDate(detours.find((detour) => detour.id === "market"), "2026-09-28"), true);
  assert.equal(nextOpenDate([clocktower, viewpoint], "2026-09-30"), "2026-10-01");
});

test("時間内・要確認・時間超過・休業日・経路失敗を区別する", () => {
  const outdoor = makeCandidates([crossing], [], {});
  assert.equal(evaluateCourse(outdoor[0], "2026-09-26", 390, "normal", outdoor).status, "目安では収まる");

  const indoor = makeCandidates([viewpoint], [], {});
  assert.equal(evaluateCourse(indoor[0], "2026-09-26", 390, "normal", indoor).status, "要確認");

  const closed = makeCandidates([clocktower], [], {});
  assert.equal(evaluateCourse(closed[0], "2026-09-30", 390, "normal", closed).status, "休業日");
  assert.equal(evaluateCourse(outdoor[0], "2026-09-26", 30, "normal", outdoor).status, "目安でも収まらない");

  const withLeg = makeCandidates([crossing, viewpoint], [], {});
  const unavailable = evaluateCourse(withLeg[0], "2026-09-26", 390, "route_error", withLeg);
  assert.equal(unavailable.status, "計算できない");
  assert.equal(unavailable.totalMinutes, null);
});
