import assert from "node:assert/strict";
import test from "node:test";
import { isKnownClosed, planVerifiedCourse } from "../app/_data/real-planner.ts";

const library = {
  id: "library", name: "飛騨市図書館", stay_minutes: 20,
  closed_weekdays: [1], closed_last_friday: true,
};
const station = {
  id: "station", name: "飛騨古川駅", stay_minutes: 15,
  closed_weekdays: [], closed_last_friday: false,
};
const officialLeg = {
  from_spot_id: "library", to_spot_id: "station", mode: "walking", minutes: 7,
  source_url: "https://www.hida-kankou.jp/courses/73",
};

test("根拠のある一方向の区間だけで訪問順を提案する", () => {
  const course = planVerifiedCourse([station, library], [officialLeg]);
  assert.deepEqual(course.stops.map((spot) => spot.id), ["library", "station"]);
  assert.equal(course.moveMinutes, 7);
  assert.equal(course.totalMinutes, 62);
});

test("区間が未確認なら移動時間を作らない", () => {
  assert.equal(planVerifiedCourse([library, station], []), null);
  assert.equal(planVerifiedCourse([library, library], [officialLeg]), null);
});

test("図書館の既知の定例休館日を事前に検出する", () => {
  assert.equal(isKnownClosed(library, "2026-09-28"), true);
  assert.equal(isKnownClosed(library, "2026-09-25"), true);
  assert.equal(isKnownClosed(library, "2026-10-02"), false);
  assert.equal(isKnownClosed(station, "2026-09-28"), false);
});
