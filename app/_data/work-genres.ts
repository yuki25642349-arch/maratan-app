export type WorkGenre = "ドラマ" | "アニメ" | "映画";
export type GenreFilter = "すべて" | WorkGenre;

// 作品のシリーズ側のジャンルを優先する。映画版でも「映画」タブには重複表示しない。
const franchiseGenres: Record<string, WorkGenre> = {
  w_58400b8a7b1dea: "アニメ", // 銀魂2
  w_b5bd6f96aad833: "アニメ", // るろうに剣心 京都大火編
  w_8c5ba04e49b6a6: "アニメ", // るろうに剣心
  w_05b4dd137d91ff: "アニメ", // 3月のライオン
  w_b93af955e81755: "ドラマ", // 五十年目の俺たちの旅
  w_fe1d58fbde845a: "ドラマ", // スパイの妻〈劇場版〉
};

export function workGenre(work: { id: string; category: string | null }): WorkGenre | null {
  if (franchiseGenres[work.id]) return franchiseGenres[work.id];
  if (work.category === "ドラマ" || work.category === "アニメ" || work.category === "映画") return work.category;
  return null;
}

export function matchesGenre(work: { id: string; category: string | null }, filter: GenreFilter) {
  return filter === "すべて" || workGenre(work) === filter;
}

// 画面に出す作品の種類。タブの分類（workGenre）は変えず、実写・アニメの違いが分かる表記にする。
export function workTypeLabel(work: { id: string; category: string | null; version?: string | null }): string {
  const genre = workGenre(work);
  const version = work.version ?? "";
  if (work.category === "映画" && genre === "アニメ") return "実写映画";
  if (work.category === "映画" && genre === "ドラマ") return "ドラマの劇場版";
  if (genre === "アニメ" && /劇場/.test(version)) return "アニメ映画";
  if (genre === "アニメ") return "アニメ";
  return genre ?? work.category ?? "作品";
}

// 調査メモ（「〜は未確認」など）を除いた、利用者向けの版表記。
export function displayVersion(version: string | null | undefined): string | null {
  if (!version) return null;
  const parts = version.split("・").filter((part) => !part.includes("未確認"));
  const text = parts.join("・").trim();
  return text && text !== "版" ? text : null;
}
