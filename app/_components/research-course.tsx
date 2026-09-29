"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VerifiedDetour } from "../_data/anilist-types";
import { bestAxisOrder, DETOUR_CATEGORY_LABELS, metersBetween } from "../_data/local-detours";
import { isKnownClosed } from "../_data/real-planner";
import type { ResearchWork } from "../_data/research-works";
import type { ResearchSpot } from "../_data/research-spots";
import { displayVersion } from "../_data/work-genres";
import DetourCard, { DetourNote, pickRecommendedDetours } from "./detour-card";
import LegSummary from "./leg-summary";
import ShareCourse from "./share-course";
import { courseUrl, sharedSelection, type CourseOptions } from "../_data/course-url";
import type { LegOption, TransitKind } from "../_data/transit-label";

type LegResult = LegOption & { walkingMeters: number | null; fareYen: number | null; alternative: LegOption | null; transitKind: TransitKind | null };

const MAX_STOPS = 3;
const MAX_DETOURS = 2;
/** 調査リストの聖地には滞在時間の登録がないため、見学・撮影の目安として使う。 */
const SEICHI_STAY_MINUTES = 20;

function formatMinutes(total: number) {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return `${minutes}分`;
  return minutes ? `${hours}時間${minutes}分` : `${hours}時間`;
}

type Anchor = { id: string; latitude: number; longitude: number; placeId: string; mapsUri: string | null };
type DetourSearch = { detours: VerifiedDetour[]; anchors: Anchor[]; unlocated: string[]; pinned: "included" | "out-of-reach" | "none" };
type DetourState = { status: "idle" | "loading" | "ready" | "error"; message?: string; unlocated?: string[]; pinned?: "included" | "out-of-reach" | "none" };
/** 経路リンクに渡す1地点。聖地は名称で、位置を特定できた地点と寄り道は Place ID も渡す。 */
type RoutePoint = { id: string; name: string; query: string; placeId: string | null; detour: VerifiedDetour | null };

function todayInJapan() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function pointDirectionsUrl(from: RoutePoint, to: RoutePoint, mode: "walking" | "transit" = "transit") {
  const params = new URLSearchParams({ api: "1", origin: from.query, destination: to.query, travelmode: mode });
  if (from.placeId) params.set("origin_place_id", from.placeId);
  if (to.placeId) params.set("destination_place_id", to.placeId);
  return `https://www.google.com/maps/dir/?${params}`;
}

function pointRouteUrl(points: RoutePoint[], allWalking: boolean) {
  const first = points[0];
  const last = points[points.length - 1];
  const params = new URLSearchParams({ api: "1", origin: first.query, destination: last.query });
  // Googleマップは電車・バスの経路に経由地を入れられないため、全区間が徒歩のときだけ徒歩で開く。
  if (allWalking) params.set("travelmode", "walking");
  if (first.placeId) params.set("origin_place_id", first.placeId);
  if (last.placeId) params.set("destination_place_id", last.placeId);
  const middle = points.slice(1, -1);
  if (middle.length) {
    params.set("waypoints", middle.map((point) => point.query).join("|"));
    if (middle.every((point) => point.placeId)) params.set("waypoint_place_ids", middle.map((point) => point.placeId).join("|"));
  }
  return `https://www.google.com/maps/dir/?${params}`;
}

function placeQuery(spot: ResearchSpot) {
  return `${spot.region.replace("・", " ")} ${spot.name}`;
}

function placeUrl(spot: ResearchSpot) {
  return `https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query: placeQuery(spot) })}`;
}

/** 地点の確かさを短いラベルと、開いたときの説明に分ける。 */
function spotNotes(spot: ResearchSpot) {
  const notes: Array<{ tag: string; detail: string }> = [];
  if (spot.granularity !== "地点") notes.push({ tag: "エリア", detail: `${spot.granularity}単位の候補です。正確な場所は出典で確認してください。` });
  if (spot.sourceStage.startsWith("推しワク")) notes.push({ tag: "現地未確認", detail: "紹介サイトの掲載情報です。現地の状況は確認できていません。" });
  else if (spot.sourceStage !== "本文記載確認") notes.push({ tag: "確認中", detail: "掲載情報を確認中の地点です。" });
  return notes;
}

function SpotDetails({ spot }: { spot: ResearchSpot }) {
  return <details className="detail-disclosure spot-more">
    <summary>場所・出典</summary>
    <div className="disclosure-body">
      {spotNotes(spot).map((note) => <p key={note.tag}>{note.detail}</p>)}
      <div className="disclosure-links">
        <a href={placeUrl(spot)} target="_blank" rel="noreferrer">Googleマップで場所を見る ↗</a>
        <a href={spot.sourceUrl} target="_blank" rel="noreferrer">出典 ↗</a>
        {spot.listingUrl ? <a href={spot.listingUrl} target="_blank" rel="noreferrer">推しワク掲載ページ ↗</a> : null}
      </div>
    </div>
  </details>;
}

export default function ResearchCourse({ work, region, options, onBack }: { work: ResearchWork; region: string; options?: CourseOptions; onBack: () => void }) {
  const [spots, setSpots] = useState<ResearchSpot[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [visitDate, setVisitDate] = useState(todayInJapan);
  const [detours, setDetours] = useState<VerifiedDetour[]>([]);
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [detourState, setDetourState] = useState<DetourState>({ status: "idle" });
  const [selectedDetourIds, setSelectedDetourIds] = useState<string[]>([]);
  const detourKey = useRef("");
  const detourCache = useRef(new Map<string, DetourSearch>());
  const [legCache, setLegCache] = useState<Record<string, Array<LegResult | null>>>({});
  const visitDateRef = useRef(visitDate);
  const planRef = useRef<HTMLElement | null>(null);
  const scrolledToPlan = useRef(false);
  const version = displayVersion(work.version);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/research-spots?workId=${encodeURIComponent(work.id)}`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("地点を取得できませんでした。");
      const data = await response.json();
      const matching = (Array.isArray(data.spots) ? data.spots : []).filter((spot: ResearchSpot) => spot.region === region);
      setSpots(matching);
      // 共有リンクで聖地が指定されていれば、その並びで始める。
      const ids = matching.map((spot: ResearchSpot) => spot.id);
      setSelectedIds(sharedSelection(options?.spots, ids, MAX_STOPS) ?? ids.slice(0, MAX_STOPS));
      setError("");
      setLoading(false);
    }).catch(() => { if (!controller.signal.aborted) { setError("地点を取得できませんでした。通信状況を確認して、もう一度お試しください。"); setLoading(false); } });
    return () => controller.abort();
    // 共有リンクの指定は最初の読み込み時だけ使う。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work.id, region, attempt]);

  // 地点の並び順に関係なく、同じ組み合わせなら同じ寄り道を使う。
  const selectionKey = [...selectedIds].sort().join(",");

  function toggleSpot(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < MAX_STOPS ? [...current, id] : current);
  }

  // 選んだ地点の区間で、地域の食・文化にふれられる寄り道を Gemini と Google マップから探す。
  // 見つかったら、おすすめを最初から訪問順の案に入れる（不要なら外せる）。
  const searchDetours = useCallback(async (ids: string[], key: string) => {
    detourKey.current = key;
    const apply = (found: DetourSearch) => {
      setDetours(found.detours);
      setAnchors(found.anchors);
      setSelectedDetourIds(pickRecommendedDetours(found.detours, visitDateRef.current, MAX_DETOURS));
      setDetourState({ status: "ready", unlocated: found.unlocated, pinned: found.pinned });
    };
    const cached = detourCache.current.get(key);
    if (cached) { apply(cached); return; }
    setDetours([]);
    setAnchors([]);
    setSelectedDetourIds([]);
    setDetourState({ status: "loading" });
    try {
      const response = await fetch("/api/detours", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workId: work.id, region, researchSpotIds: ids, visitDate: visitDateRef.current, ...(options?.pin ? { pinPlaceId: options.pin } : {}) }) });
      const data = await response.json();
      if (detourKey.current !== key) return;
      if (!response.ok) throw new Error(data.error || "寄り道候補を取得できませんでした。");
      const found: DetourSearch = { detours: Array.isArray(data.detours) ? data.detours : [], anchors: Array.isArray(data.anchors) ? data.anchors : [],
        unlocated: Array.isArray(data.unlocated) ? data.unlocated : [], pinned: data.pinned === "included" || data.pinned === "out-of-reach" ? data.pinned : "none" };
      detourCache.current.set(key, found);
      apply(found);
    } catch (fetchError) {
      if (detourKey.current !== key) return;
      setDetourState({ status: "error", message: fetchError instanceof Error ? fetchError.message : "寄り道候補を取得できませんでした。" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work.id, region]);

  // 「食・お店から探す」から来たときは、選んだ店が入ったコースをすぐ見られるようにする。
  useEffect(() => {
    if (!options?.pin || scrolledToPlan.current || detourState.status !== "ready") return;
    scrolledToPlan.current = true;
    planRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [options?.pin, detourState.status]);

  // 地点の選択が落ち着いたら自動で探す（チェックを続けて付け外ししている間は待つ）。
  useEffect(() => {
    if (!selectedIds.length || detourKey.current === selectionKey) return;
    const ids = [...selectedIds];
    const timer = window.setTimeout(() => void searchDetours(ids, selectionKey), 700);
    return () => window.clearTimeout(timer);
    // 並び替えだけでは探し直さない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, searchDetours]);

  function changeVisitDate(date: string) {
    setVisitDate(date);
    visitDateRef.current = date;
    // 選んだ日が定休日の寄り道は、訪問順の案から外す。
    setSelectedDetourIds((current) => current.filter((id) => { const spot = detours.find((item) => item.id === id); return !spot || !isKnownClosed(spot, date); }));
  }

  function toggleDetour(id: string) {
    setSelectedDetourIds((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < MAX_DETOURS ? [...current, id] : current);
  }

  function moveSpot(id: string, direction: -1 | 1) {
    setSelectedIds((current) => {
      const index = current.indexOf(id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const updated = [...current];
      [updated[index], updated[nextIndex]] = [updated[nextIndex], updated[index]];
      return updated;
    });
  }

  const ordered = selectedIds.map((id) => spots.find((spot) => spot.id === id)).filter((spot): spot is ResearchSpot => Boolean(spot));
  const selectedDetours = detours.filter((spot) => selectedDetourIds.includes(spot.id));
  // 聖地を軸にし、寄り道は聖地と聖地の区間の中で遠回りが最も少ない位置に入れる。
  const coordinates = new Map<string, { latitude: number; longitude: number }>([...anchors.map((anchor) => [anchor.id, anchor] as const), ...detours.map((spot) => [spot.id, spot] as const)]);
  const seichiIds = ordered.map((spot) => spot.id);
  const axis = bestAxisOrder(seichiIds, selectedDetours.map((spot) => spot.id), (from, to) => {
    const a = coordinates.get(from), b = coordinates.get(to);
    // 位置が分からない地点があっても、聖地を軸にした並び（寄り道は区間内）は保つ。
    return a && b ? metersBetween(a, b) : 0;
  });
  const points: RoutePoint[] = (axis?.order ?? seichiIds).flatMap((id): RoutePoint[] => {
    const spot = ordered.find((item) => item.id === id);
    if (spot) return [{ id, name: spot.name, query: placeQuery(spot), placeId: anchors.find((anchor) => anchor.id === id)?.placeId ?? null, detour: null }];
    const detour = detours.find((item) => item.id === id);
    return detour ? [{ id, name: detour.name, query: detour.name, placeId: detour.place_id, detour }] : [];
  });
  const recommended = pickRecommendedDetours(detours, visitDate, MAX_DETOURS);

  // 位置が分かった地点どうしなら、区間ごとに「徒歩 約○分／バスで約○分」を調べる。
  const legKey = points.length > 1 && points.every((point) => point.placeId) ? `${visitDate}|${points.map((point) => point.placeId).join(",")}` : "";
  const legs = legKey ? legCache[legKey] : undefined;
  useEffect(() => {
    if (!legKey || legCache[legKey] !== undefined) return;
    const [date, ids] = legKey.split("|");
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch("/api/legs", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ placeIds: ids.split(","), visitDate: date }) })
        .then(async (response) => response.ok ? (await response.json()).legs as Array<LegResult | null> : null)
        .then((result) => { if (result) setLegCache((current) => ({ ...current, [legKey]: result })); })
        .catch(() => undefined);
    }, 500);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [legKey, legCache]);
  // 現地での所要時間の目安：滞在（聖地は目安20分、寄り道は種類ごとの目安）＋ 区間ごとの移動。
  const stayMinutes = points.reduce((sum, point) => sum + (point.detour ? point.detour.stay_minutes : SEICHI_STAY_MINUTES), 0);
  const legsKnown = points.length < 2 || Boolean(legs && legs.length === points.length - 1 && legs.every(Boolean));
  const moveMinutes = legsKnown && legs ? legs.reduce((sum, leg) => sum + (leg?.minutes ?? 0), 0) : 0;
  const sharePath = courseUrl(work.id, region, { spots: selectedIds, pin: options?.pin });

  return <section className="screen-section research-course-screen">
    <button className="text-back" type="button" onClick={onBack}>← 作品一覧へ戻る</button>
    <div className="section-heading"><div>
      <p className="page-kicker"><span>{region}</span>{version ? <span>{version}</span> : null}</p>
      <h1>{work.title}</h1>
      <p>{spots.length === 1 ? "この地域の聖地と、その前後で寄れる地元の味・文化スポットをつないだコースを作ります。" : `巡りたい聖地を最大${MAX_STOPS}件選ぶと、訪問順の案と、途中で寄れる地元の味・文化スポットが分かります。`}</p>
    </div></div>

    {loading ? <p className="loading-note" role="status">地点を読み込んでいます…</p> : null}
    {error ? <div className="inline-error" role="alert"><p>{error}</p><button className="text-button" type="button" onClick={() => { setError(""); setLoading(true); setAttempt((value) => value + 1); }}>再読み込み</button></div> : null}

    {!loading && !error && spots.length ? <div className="research-course-layout">
      <section aria-labelledby="choose-heading">
        <div className="choose-heading">
          <h2 id="choose-heading">{spots.length === 1 ? "① この地域の聖地" : "① 巡る聖地を選ぶ"}</h2>
          {spots.length > 1 ? <span className="choose-count" role="status">{selectedIds.length}／{MAX_STOPS}件</span> : null}
        </div>
        <ul className="choose-list">{spots.map((spot) => {
          const checked = selectedIds.includes(spot.id);
          const disabled = !checked && selectedIds.length >= MAX_STOPS;
          return <li className={`choose-item${checked ? " is-selected" : ""}${disabled ? " is-disabled" : ""}`} key={spot.id}>
            <label><input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggleSpot(spot.id)} /><strong>{spot.name}</strong>{spotNotes(spot).map((note) => <span className="spot-tag" key={note.tag}>{note.tag}</span>)}</label>
            <SpotDetails spot={spot} />
          </li>;
        })}</ul>
        {selectedIds.length >= MAX_STOPS && spots.length > MAX_STOPS ? <p className="field-hint">入れ替えるときは、選択中の地点のチェックを外してください。</p> : null}
      </section>

      <section ref={planRef} className="research-course-result" aria-labelledby="plan-heading" aria-live="polite">
        <h2 id="plan-heading">② 訪問順の案</h2>
        {ordered.length ? <div className="plan-summary">
          <p>現地での所要時間の目安 <b>{legsKnown ? `約${formatMinutes(stayMinutes + moveMinutes)}` : "計算中…"}</b></p>
          <small>{legsKnown ? `滞在 約${formatMinutes(stayMinutes)}${points.length > 1 ? `・移動 約${formatMinutes(moveMinutes)}` : ""}` : `滞在 約${formatMinutes(stayMinutes)}・移動時間を調べています`}。最初の地点までと最後の地点からの移動は含みません。</small>
        </div> : null}
        {detourState.pinned === "out-of-reach" ? <p className="field-hint">選んだお店は聖地から離れているため、コースには入れていません。</p> : null}
        {selectedDetourIds.length ? <p className="detour-included">聖地の区間の途中に、地元の味や文化にふれられる<b>寄り道</b>を入れています。不要なら「✕」で外せます。</p> : null}
        {detourState.status === "loading" ? <p className="loading-note" role="status">寄り道を探しています…</p> : null}
        {ordered.length ? <>
          <ol>{points.map((point, index) => {
            const seichiIndex = ordered.findIndex((spot) => spot.id === point.id);
            return <li key={point.id} className={point.detour ? "is-detour" : undefined}>
              <div className="plan-stop">
                <span className="stop-number" aria-hidden="true">{index + 1}</span>
                <span className="plan-stop-name"><strong>{point.name}</strong>{point.detour ? <small>{DETOUR_CATEGORY_LABELS[point.detour.category]}の寄り道</small> : null}</span>
                {point.detour ? <div className="order-buttons"><button type="button" className="stop-remove" onClick={() => toggleDetour(point.id)} aria-label={`${point.name}をコースから外す`}>✕ 外す</button></div>
                  : ordered.length > 1 ? <div className="order-buttons">
                    <button type="button" onClick={() => moveSpot(point.id, -1)} disabled={seichiIndex === 0} aria-label={`${point.name}を一つ前へ`}>↑</button>
                    <button type="button" onClick={() => moveSpot(point.id, 1)} disabled={seichiIndex === ordered.length - 1} aria-label={`${point.name}を一つ後へ`}>↓</button>
                  </div> : null}
              </div>
              {points[index + 1] ? legs?.[index] ? <div className="plan-leg-box"><LegSummary leg={legs[index]!} href={pointDirectionsUrl(point, points[index + 1], legs[index]!.mode)} /></div>
                : <a className="plan-leg" href={pointDirectionsUrl(point, points[index + 1])} target="_blank" rel="noreferrer">次までの経路 ↗</a> : null}
            </li>;
          })}</ol>
          {points.length > 1 ? <a className="primary-button" href={pointRouteUrl(points, Boolean(legs?.length && legs.every((leg) => leg?.mode === "walking")))} target="_blank" rel="noreferrer">この順番でGoogleマップを開く ↗</a> : null}
          <ShareCourse path={sharePath} title={`${work.title}・${region}のコース`} />
          <p className="field-hint">{legs?.some(Boolean) ? "移動時間は訪問日の昼ごろに出発した場合の目安です。バスの本数や営業時間は、各「経路」とお店の情報で確認してください。" : "移動時間と営業状況は、Googleマップで訪問日時を指定して確認してください。"}</p>

          <div className="research-detours" aria-busy={detourState.status === "loading"}>
            <h3>③ 寄り道を入れ替える</h3>
            <p className="field-hint">聖地の区間の途中で寄れる、地元の味や文化にふれられる場所です。チェックを付け外しすると訪問順の案に反映されます（最大{MAX_DETOURS}件）。</p>
            <label className="detour-date">訪問日<input type="date" min={todayInJapan()} value={visitDate} onChange={(event) => changeVisitDate(event.target.value)} /><small>定休日の確認に使います</small></label>
            {detourState.status === "loading" ? <p className="loading-note" role="status">地域の寄り道を探しています…</p> : null}
            {detourState.status === "error" ? <div className="inline-error" role="alert"><p>{detourState.message}</p><button className="text-button" type="button" onClick={() => void searchDetours([...selectedIds], selectionKey)}>もう一度探す</button></div> : null}
            {detourState.status === "ready" && detourState.unlocated?.length ? <p className="field-hint">{detourState.unlocated.map((id) => ordered.find((spot) => spot.id === id)?.name).filter(Boolean).join("、")}は位置を特定できなかったため、寄り道探しに使っていません。</p> : null}
            {detourState.status === "ready" && !detours.length ? <p className="field-hint" role="status">条件に合う寄り道は見つかりませんでした。</p> : null}
            {detourState.status === "ready" && recommended.length && !selectedDetourIds.length ? <button className="secondary-button" type="button" onClick={() => setSelectedDetourIds(recommended)}>おすすめの寄り道を入れる</button> : null}
            {detours.length ? <ul className="detour-list">{detours.map((spot) => {
              const checked = selectedDetourIds.includes(spot.id);
              const closed = isKnownClosed(spot, visitDate);
              return <DetourCard key={spot.id} spot={spot} checked={checked} closed={closed} visitDate={visitDate}
                disabled={!checked && (closed || selectedDetourIds.length >= MAX_DETOURS)} onToggle={() => toggleDetour(spot.id)} />;
            })}</ul> : null}
            {detours.length ? <DetourNote /> : null}
          </div>
        </> : <p className="field-hint">巡りたい地点にチェックを入れてください。</p>}
      </section>
    </div> : null}

    {!loading && !error ? <p className="caution-note"><strong>出発前に</strong>位置・営業状況・立入の可否を公式情報で確認し、学校・住宅地・施設の敷地には許可なく入らないでください。</p> : null}
  </section>;
}
