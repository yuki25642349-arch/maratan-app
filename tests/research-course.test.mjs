import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const works = JSON.parse(await readFile(new URL("../app/_data/research-works-preview.json", import.meta.url), "utf8"));
const spots = JSON.parse(await readFile(new URL("../app/_data/research-spots-preview.json", import.meta.url), "utf8"));
const oshiWakuSpots = JSON.parse(await readFile(new URL("../app/_data/oshiwaku-spots-preview.json", import.meta.url), "utf8"));

test("調査リストの全作品・全地域に参考コース用の掲載地点がある", () => {
  assert.equal(works.length, 93);
  assert.equal(spots.length, 233);
  for (const work of works) {
    for (const region of work.regions) {
      assert.ok(spots.some((spot) => spot.workId === work.id && spot.region === region), `${work.title} / ${region}`);
    }
  }
});

test("参考コースの地点は出典を保持し、未確認座標を付与しない", () => {
  const allSpots = [...spots, ...oshiWakuSpots];
  assert.equal(new Set(allSpots.map((spot) => spot.id)).size, allSpots.length);
  for (const spot of allSpots) {
    assert.match(spot.sourceUrl, /^https:\/\//);
    assert.equal("latitude" in spot, false);
    assert.equal("longitude" in spot, false);
  }
});

test("推しワクの補完地点は作品・地域と掲載ページを保持する", () => {
  assert.ok(oshiWakuSpots.length > 0);
  for (const spot of oshiWakuSpots) {
    const work = works.find((item) => item.id === spot.workId);
    assert.ok(work?.regions.includes(spot.region));
    assert.match(spot.listingUrl, /^https:\/\/oshiwaku\.net\/seichi\/sp-/);
    assert.equal(spot.sourceStage, "推しワク掲載・現地未確認");
  }
});
