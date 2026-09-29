import assert from "node:assert/strict";
import test from "node:test";
import {
  categoryFromTypes, closedWeekdaysFromPeriods, extractJson, isWithinReach, matchGroundedPicks, normalizePlaceId,
  openingHoursTextFor, safeDetourText, safeMapsUri, slotLabel, suggestSlot,
} from "../app/_data/local-detours.ts";

// 飛騨古川付近の聖地（座標は概略）
const library = { id: "p_library", name: "飛騨市図書館", latitude: 36.2381, longitude: 137.1866 };
const station = { id: "p_station", name: "飛騨古川駅", latitude: 36.2372, longitude: 137.1895 };
const shrine = { id: "p_shrine", name: "気多若宮神社", latitude: 36.2425, longitude: 137.1830 };

test("Place ID は places/ 付きでも素のIDでも受け付け、不正な文字列は捨てる", () => {
  assert.equal(normalizePlaceId("places/ChIJN1t_tDeuEmsRUsoyG83frY4"), "ChIJN1t_tDeuEmsRUsoyG83frY4");
  assert.equal(normalizePlaceId("ChIJN1t_tDeuEmsRUsoyG83frY4"), "ChIJN1t_tDeuEmsRUsoyG83frY4");
  assert.equal(normalizePlaceId("../../etc/passwd"), null);
  assert.equal(normalizePlaceId("short"), null);
  assert.equal(normalizePlaceId(42), null);
});

test("カテゴリは Places API の種別から決める", () => {
  assert.equal(categoryFromTypes("japanese_restaurant"), "food");
  assert.equal(categoryFromTypes("confectionery"), "food");
  assert.equal(categoryFromTypes("museum"), "culture");
  assert.equal(categoryFromTypes("gift_shop"), "shopping");
  assert.equal(categoryFromTypes(null, ["point_of_interest", "art_studio"]), "culture");
  assert.equal(categoryFromTypes("liquor_store"), "shopping");
});

test("営業時間から、1日も開かない曜日だけを休業日にする", () => {
  const periods = [1, 2, 3, 4, 5, 6].map((day) => ({ open: { day, hour: 10 }, close: { day, hour: 17 } }));
  assert.deepEqual(closedWeekdaysFromPeriods(periods), [0]);
  assert.deepEqual(closedWeekdaysFromPeriods([{ open: { day: 0, hour: 0, minute: 0 } }]), [], "24時間営業");
  assert.deepEqual(closedWeekdaysFromPeriods([]), [], "営業時間不明は休業扱いしない");
  assert.deepEqual(closedWeekdaysFromPeriods(undefined), []);
});

test("訪問日の曜日に対応する営業時間の行を返す（Googleは月曜始まり）", () => {
  const lines = ["月曜日: 10時00分～17時00分", "火曜日: 定休日", "水曜日: x", "木曜日: x", "金曜日: x", "土曜日: x", "日曜日: 9時00分～15時00分"];
  assert.equal(openingHoursTextFor(lines, "2026-09-27"), lines[6]); // 日曜
  assert.equal(openingHoursTextFor(lines, "2026-09-28"), lines[0]); // 月曜
  assert.equal(openingHoursTextFor(lines.slice(0, 3), "2026-09-28"), null);
});

test("聖地から離れすぎた場所は寄り道にしない", () => {
  assert.equal(isWithinReach({ latitude: 36.2390, longitude: 137.1880 }, [library, station]), true);
  assert.equal(isWithinReach({ latitude: 36.1461, longitude: 137.2522 }, [library, station]), false, "高山駅付近は約11km離れている");
});

test("聖地が2件以上なら寄り道は必ず区間（間）に、1件なら「前後」と提案する", () => {
  const between = suggestSlot({ latitude: 36.2377, longitude: 137.1881 }, [library, station, shrine]);
  assert.deepEqual(between, { kind: "between", fromId: "p_library", toId: "p_station" });
  const outside = suggestSlot({ latitude: 36.2330, longitude: 137.1990 }, [library, shrine]);
  assert.equal(outside.kind, "between");
  const names = { p_library: "飛騨市図書館", p_station: "飛騨古川駅" };
  assert.match(slotLabel(between, names), /「飛騨市図書館」と「飛騨古川駅」の間/);
  assert.equal(suggestSlot({ latitude: 36.2, longitude: 137.1 }, [library]).kind, "near");
});

test("Gemini の応答からコードフェンス付きでも JSON を取り出す", () => {
  assert.deepEqual(extractJson('```json\n[{"name":"a"}]\n```'), [{ name: "a" }]);
  assert.deepEqual(extractJson('候補です。[{"name":"b"}] 以上'), [{ name: "b" }]);
  assert.equal(extractJson("見つかりませんでした"), null);
});

test("営業・価格・作品との関係を断定する紹介文は使わない", () => {
  assert.equal(safeDetourText("飛騨牛や朴葉味噌など飛騨の郷土料理を味わえる"), "飛騨牛や朴葉味噌など飛騨の郷土料理を味わえる");
  assert.equal(safeDetourText("今なら営業中で予約不要"), null);
  assert.equal(safeDetourText("ランチは1,200円"), null);
  assert.equal(safeDetourText("作品に登場したお店"), null);
  assert.equal(safeDetourText("a".repeat(200)), null);
});

test("Googleマップの根拠に含まれない店はAIの創作とみなして捨てる", () => {
  const grounded = [
    { placeId: "ChIJaaaaaaaaaaaaaaaa", title: "三嶋和ろうそく店", uri: "https://maps.google.com/?cid=1" },
    { placeId: "ChIJbbbbbbbbbbbbbbbb", title: "蕪水亭", uri: "https://maps.google.com/?cid=2" },
  ];
  const raw = [
    { name: "三嶋 和ろうそく店", localFeature: "飛騨古川の伝統の和ろうそく", reason: "図書館から歩いて寄れる伝統工芸の店" },
    { name: "架空の郷土料理店", localFeature: "郷土料理", reason: "おいしい" },
    { name: "蕪水亭", placeId: "places/ChIJbbbbbbbbbbbbbbbb", localFeature: "飛騨の郷土料理", reason: "駅に近く食事に寄りやすい" },
    { name: "蕪水亭", localFeature: "重複", reason: "重複" },
  ];
  const picks = matchGroundedPicks(raw, grounded);
  assert.deepEqual(picks.map((pick) => pick.placeId), ["ChIJaaaaaaaaaaaaaaaa", "ChIJbbbbbbbbbbbbbbbb"]);
  assert.equal(picks[0].name, "三嶋和ろうそく店", "表示名はGoogleマップ上の名称を使う");
  assert.equal(picks[1].mapsUri, "https://maps.google.com/?cid=2");
});

test("Googleマップ以外へのリンクは表示しない", () => {
  assert.equal(safeMapsUri("https://maps.google.com/?cid=123"), "https://maps.google.com/?cid=123");
  assert.equal(safeMapsUri("https://evil.example.com/maps"), null);
  assert.equal(safeMapsUri("javascript:alert(1)"), null);
});

test("寄り道は聖地の順番を変えずに、間または前後へ差し込む", async () => {
  const { insertDetours } = await import("../app/_data/local-detours.ts");
  const between = { id: "d1", detour_slot: { kind: "between", fromId: "b", toId: "a" } };
  const nearFirst = { id: "d2", detour_slot: { kind: "near", spotId: "a" } };
  const nearLast = { id: "d3", detour_slot: { kind: "near", spotId: "c" } };
  assert.deepEqual(insertDetours(["a", "b", "c"], [between]), ["a", "d1", "b", "c"]);
  assert.deepEqual(insertDetours(["a", "b", "c"], [nearFirst, nearLast]), ["d2", "a", "b", "c", "d3"]);
  // 隣り合っていない2地点の「間」は、片方の前後に入れる
  assert.deepEqual(insertDetours(["a", "c", "b"], [between]), ["a", "c", "b", "d1"]);
  assert.deepEqual(insertDetours(["a"], [nearFirst]), ["a", "d2"]);
});

test("位置検索で別の地域に外れた地点は基準から除く", async () => {
  const { consistentAnchors } = await import("../app/_data/local-detours.ts");
  const hida = [{ id: "x", latitude: 36.2381, longitude: 137.1866 }, { id: "y", latitude: 36.2372, longitude: 137.1895 }];
  const far = { id: "z", latitude: 35.6812, longitude: 139.7671 };
  assert.deepEqual(consistentAnchors([...hida, far]).map((a) => a.id), ["x", "y"]);
  assert.deepEqual(consistentAnchors([hida[0]]).map((a) => a.id), ["x"]);
  assert.deepEqual(consistentAnchors([hida[0], far]).map((a) => a.id), ["x"]);
});

test("訪問順は聖地を軸にし、寄り道は聖地と聖地の区間の中にだけ入れる", async () => {
  const { axisOrders, bestAxisOrder } = await import("../app/_data/local-detours.ts");
  // 聖地 A→B→C の順番は変えず、先頭と末尾は必ず聖地
  const orders = axisOrders(["A", "B", "C"], ["x"]);
  assert.deepEqual(orders.map((order) => order.join("")).sort(), ["ABxC", "AxBC"]);
  for (const order of axisOrders(["A", "B", "C"], ["x", "y"])) {
    assert.equal(order[0], "A");
    assert.equal(order[order.length - 1], "C");
    assert.deepEqual(order.filter((id) => "ABC".includes(id)), ["A", "B", "C"]);
  }
  // 聖地が1件なら前後どちらにも入れられる
  assert.deepEqual(axisOrders(["A"], ["x"]).map((order) => order.join("")).sort(), ["Ax", "xA"]);
  // 区間ごとの移動時間が最小になる区間に入る（x は B と C の間にある）
  const minutes = { AB: 10, BC: 10, AC: 15, Ax: 20, xB: 20, Bx: 3, xC: 3, xA: 20, CB: 10, BA: 10 };
  const best = bestAxisOrder(["A", "B", "C"], ["x"], (from, to) => minutes[from + to] ?? null);
  assert.deepEqual(best, { order: ["A", "B", "x", "C"], cost: 16 });
  // 移動時間が分からない区間しかなければ null
  assert.equal(bestAxisOrder(["A", "B"], ["x"], () => null), null);
});

test("区間の移動手段を「徒歩」「バス」「電車」に分けて表示する", async () => {
  const { transitKindOf, legText, chooseLeg, showAlternative } = await import("../app/_data/transit-label.ts");
  assert.equal(transitKindOf(["BUS"]), "bus");
  assert.equal(transitKindOf(["HEAVY_RAIL", "COMMUTER_TRAIN"]), "train");
  assert.equal(transitKindOf(["BUS", "SUBWAY"]), "mixed");
  assert.equal(transitKindOf([]), null);
  assert.equal(legText({ mode: "transit", minutes: 12, transitKind: "bus" }), "バスで約12分");
  assert.equal(legText({ mode: "walking", minutes: 8, transitKind: null }), "徒歩 約8分");
  const walk = { mode: "walking", minutes: 25, transitKind: null };
  const bus = { mode: "transit", minutes: 12, transitKind: "bus" };
  assert.deepEqual(chooseLeg(walk, bus), { chosen: bus, alternative: walk });
  // ほぼ同じなら待ち時間の読めないバスより徒歩
  assert.equal(chooseLeg({ ...walk, minutes: 14 }, bus).chosen.mode, "walking");
  assert.equal(chooseLeg(null, null), null);
  assert.equal(showAlternative(bus, walk), true, "バスの区間は徒歩の分数も見せる");
  assert.equal(showAlternative({ ...walk, minutes: 6 }, bus), false, "短い徒歩ならバスは出さない");
  assert.equal(showAlternative({ ...walk, minutes: 20 }, bus), true);
});

test("グラウンディングの名前がローマ字でも、Places の日本語名で照合できる", async () => {
  const { matchGroundedPicks, cleanGroundedTitle } = await import("../app/_data/local-detours.ts");
  assert.equal(cleanGroundedTitle("Ajidokoro Furukawa - Google Maps"), "Ajidokoro Furukawa");
  const grounded = [{ placeId: "ChIJaaaaaaaaaaaaaaaa", title: "Ajidokoro Furukawa - Google Maps", uri: "https://maps.google.com/?cid=1", aliases: ["味処 古川"] }];
  const picks = matchGroundedPicks([{ name: "味処古川", localFeature: "飛騨の郷土料理", reason: "駅から近い" }, { name: "架空の店", localFeature: "郷土料理", reason: "x" }], grounded);
  assert.deepEqual(picks.map((pick) => [pick.placeId, pick.name]), [["ChIJaaaaaaaaaaaaaaaa", "味処 古川"]]);
  // 日本語名がなくても、末尾の「 - Google Maps」を外して照合する
  const english = matchGroundedPicks([{ name: "Ajidokoro Furukawa", localFeature: "飛騨の郷土料理", reason: "駅から近い" }], [{ ...grounded[0], aliases: undefined }]);
  assert.equal(english.length, 1);
});

test("食・お店の検索：地域の判定と、AIが選んだ地域の検査", async () => {
  const { addressInRegion, regionsMatchingText, pickKnownRegions, categoryForWord, cleanQuery } = await import("../app/_data/food-search.ts");
  const regions = ["岩手県・久慈市", "岐阜県・飛騨市", "岐阜県・高山市", "北海道・礼文町"];
  assert.equal(addressInRegion("日本、〒028-0021 岩手県久慈市中町２丁目", "岩手県・久慈市"), true);
  assert.equal(addressInRegion("日本、〒099-0000 北海道礼文郡礼文町香深", "北海道・礼文町"), true);
  assert.equal(addressInRegion("日本、〒020-0000 岩手県盛岡市", "岩手県・久慈市"), false, "同じ県でも別の市は除く");
  assert.equal(addressInRegion(null, "岩手県・久慈市"), false);
  assert.deepEqual(regionsMatchingText("飛騨", regions), ["岐阜県・飛騨市"]);
  assert.deepEqual(regionsMatchingText("久慈市", regions), ["岩手県・久慈市"]);
  assert.deepEqual(regionsMatchingText("岐阜", regions), ["岐阜県・飛騨市", "岐阜県・高山市"]);
  assert.deepEqual(regionsMatchingText("うに", regions), []);
  assert.deepEqual(pickKnownRegions(["岩手県・久慈市", "架空県・架空市", "岩手県・久慈市", 3], regions), ["岩手県・久慈市"]);
  assert.deepEqual(pickKnownRegions({ regions: ["北海道・礼文町"] }, regions), ["北海道・礼文町"]);
  assert.equal(categoryForWord("お土産"), "shopping");
  assert.equal(categoryForWord("うに"), null);
  assert.equal(cleanQuery(" 地酒,(*) "), "地酒");
});

test("共有リンク：作品・地域・聖地の並び・選んだ店を URL で受け渡す", async () => {
  const { courseUrl, readCourseUrl, sharedSelection } = await import("../app/_data/course-url.ts");
  const url = courseUrl("w_abc", "岐阜県・飛騨市", { spots: ["p_b", "p_a"], pin: "ChIJaaaaaaaaaaaaaaaa" });
  const read = readCourseUrl(url);
  assert.deepEqual(read, { workId: "w_abc", region: "岐阜県・飛騨市", options: { pin: "ChIJaaaaaaaaaaaaaaaa", spots: ["p_b", "p_a"] } });
  assert.deepEqual(readCourseUrl("?work=w_abc&region=x&spots=<script>,p_a&pin=bad").options, { pin: undefined, spots: ["p_a"] });
  assert.equal(readCourseUrl("?work=w_abc"), null);
  assert.deepEqual(sharedSelection(["p_b", "p_x", "p_b", "p_a"], ["p_a", "p_b", "p_c"]), ["p_b", "p_a"]);
  assert.equal(sharedSelection(["p_x"], ["p_a"]), null);
  assert.equal(sharedSelection(undefined, ["p_a"]), null);
});
