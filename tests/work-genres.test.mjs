import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { matchesGenre, workGenre } from "../app/_data/work-genres.ts";

const works = JSON.parse(await readFile(new URL("../app/_data/research-works-preview.json", import.meta.url), "utf8"));
const byTitle = (title) => works.find((work) => work.title === title);

test("作品一覧はドラマ・アニメ・映画のいずれか一つに分類される", () => {
  for (const work of works) {
    assert.ok(workGenre(work), work.title);
    assert.equal(["ドラマ", "アニメ", "映画"].filter((genre) => matchesGenre(work, genre)).length, 1);
    assert.equal(matchesGenre(work, "すべて"), true);
  }
});

test("劇場アニメとアニメ作品の実写映画は映画タブに含めない", () => {
  for (const title of ["君の名は。", "サマーウォーズ", "銀魂2 掟は破るためにこそある", "るろうに剣心", "るろうに剣心 京都大火編", "3月のライオン"]) {
    const work = byTitle(title);
    assert.ok(work, title);
    assert.equal(workGenre(work), "アニメ", title);
    assert.equal(matchesGenre(work, "映画"), false, title);
  }
});

test("ドラマの劇場版はドラマ、独立した実写映画は映画に分類する", () => {
  for (const title of ["五十年目の俺たちの旅", "スパイの妻"]) {
    assert.equal(workGenre(byTitle(title)), "ドラマ", title);
    assert.equal(matchesGenre(byTitle(title), "映画"), false, title);
  }
  for (const title of ["Love Letter", "君の膵臓をたべたい"]) {
    assert.equal(workGenre(byTitle(title)), "映画", title);
  }
});

test("カードの種類表記は実写とアニメを取り違えない", async () => {
  const { workTypeLabel } = await import("../app/_data/work-genres.ts");
  assert.equal(workTypeLabel(byTitle("るろうに剣心")), "実写映画");
  assert.equal(workTypeLabel(byTitle("君の名は。")), "アニメ映画");
  assert.equal(workTypeLabel(byTitle("スパイの妻")), "ドラマの劇場版");
  assert.equal(workTypeLabel(byTitle("Love Letter")), "映画");
});

test("版表記から調査メモを除く", async () => {
  const { displayVersion } = await import("../app/_data/work-genres.ts");
  assert.equal(displayVersion("2017年実写版・前後編の別は未確認"), "2017年実写版");
  assert.equal(displayVersion("版・公開年未確認"), null);
  assert.equal(displayVersion("2016年劇場アニメ"), "2016年劇場アニメ");
  assert.equal(displayVersion(null), null);
});
