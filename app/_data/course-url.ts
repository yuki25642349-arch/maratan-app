// コース画面の URL（共有リンク）を作る・読む。

/** コース画面の追加指定。pin は「食・お店から探す」で選んだ店、spots は共有されたコースの聖地（訪問順）。 */
export type CourseOptions = { pin?: string; spots?: string[] };

export function courseUrl(workId: string, region: string, options: CourseOptions = {}) {
  const params = new URLSearchParams({ work: workId, region });
  if (options.spots?.length) params.set("spots", options.spots.join(","));
  if (options.pin) params.set("pin", options.pin);
  return `?${params}`;
}

export function readCourseUrl(search: string) {
  const params = new URLSearchParams(search);
  const workId = params.get("work");
  const region = params.get("region");
  if (!workId || !region) return null;
  const pin = params.get("pin") ?? "";
  const spots = (params.get("spots") ?? "").split(",").filter((id) => /^[A-Za-z0-9_-]{3,60}$/.test(id)).slice(0, 3);
  return { workId, region, options: { pin: /^[A-Za-z0-9_-]{10,300}$/.test(pin) ? pin : undefined, spots: spots.length ? spots : undefined } as CourseOptions };
}

/** 共有された聖地の並びのうち、今の地域にある聖地だけを使う。なければ null。 */
export function sharedSelection(spotIds: readonly string[] | undefined, available: readonly string[], max = 3) {
  const ids = (spotIds ?? []).filter((id, index, list) => available.includes(id) && list.indexOf(id) === index).slice(0, max);
  return ids.length ? ids : null;
}
