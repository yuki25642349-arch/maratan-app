"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MatchedWork, VerifiedDetour, VerifiedLeg, VerifiedSpot } from "../_data/anilist-types";
import { DETOUR_CATEGORY_LABELS } from "../_data/local-detours";
import { isKnownClosed, type VerifiedCourse } from "../_data/real-planner";
import { displayVersion } from "../_data/work-genres";
import DetourCard, { DetourBadge, DetourNote, pickRecommendedDetours } from "./detour-card";
import GoogleSpotMap from "./google-spot-map";
import LegSummary from "./leg-summary";
import ShareCourse from "./share-course";
import { courseUrl, sharedSelection, type CourseOptions } from "../_data/course-url";
import type { LegOption, TransitKind } from "../_data/transit-label";

type ApiLeg = VerifiedLeg & { source: "google-routes" | "registered"; walkingMeters: number | null; fareYen: number | null;
  transitKind: TransitKind | null; alternative: LegOption | null };
type ApiCourse = Omit<VerifiedCourse, "legs"> & { legs: ApiLeg[] };
type ItineraryResult = { course: ApiCourse; recommendation: { id: string; reason: string; source: "gemini" | "rule" }; source: "google-routes" | "registered" | "mixed"; status: "fits" | "over" | "needs-check"; stayMinutes: Record<string, number>; costs: { transitYen: number | null; admissionYen: number | null; foodExperienceYen: number | null }; notices: string[] };

const MAX_SPOTS = 3;
const MAX_DETOURS = 2;
const LONG_WALK_METERS = 3000;
type DetourState = { status: "idle" | "loading" | "ready" | "error"; message?: string; source?: "gemini-maps" | "places-search" | "mixed" | "none"; routable?: boolean; pinned?: "included" | "out-of-reach" | "none" };

const DURATION_OPTIONS = [60, 90, 120, 150, 180, 210, 240, 300, 360, 420, 480, 600, 720];

function embedUrl(spot: VerifiedSpot) {
  const padding = 0.008;
  const params = new URLSearchParams({
    bbox: `${spot.longitude - padding},${spot.latitude - padding},${spot.longitude + padding},${spot.latitude + padding}`,
    layer: "mapnik",
    marker: `${spot.latitude},${spot.longitude}`,
  });
  return `https://www.openstreetmap.org/export/embed.html?${params}`;
}

function point(spot: VerifiedSpot) {
  return `${spot.latitude},${spot.longitude}`;
}

function mapsUrl(spot: VerifiedSpot) {
  return `https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query: point(spot) })}`;
}

function directionsUrl(from: VerifiedSpot, to: VerifiedSpot, mode: VerifiedLeg["mode"]) {
  return `https://www.google.com/maps/dir/?${new URLSearchParams({ api: "1", origin: point(from), destination: point(to), travelmode: mode })}`;
}

function walkingRouteUrl(stops: VerifiedSpot[]) {
  const params = new URLSearchParams({ api: "1", origin: point(stops[0]), destination: point(stops[stops.length - 1]), travelmode: "walking" });
  if (stops.length > 2) params.set("waypoints", stops.slice(1, -1).map(point).join("|"));
  return `https://www.google.com/maps/dir/?${params}`;
}

function todayInJapan() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function formatDate(date: string) {
  const parsed = new Date(`${date}T12:00:00+09:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "long", day: "numeric", weekday: "short" }).format(parsed);
}

function formatMinutes(total: number) {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return `${minutes}分`;
  return minutes ? `${hours}時間${minutes}分` : `${hours}時間`;
}

function formatYen(value: number | null) {
  return value === null ? "不明" : value === 0 ? "0円" : `${value.toLocaleString()}円`;
}

export default function VerifiedSpotMap({ work, spots, region, options, onBack }: {
  options?: CourseOptions;
  work: MatchedWork;
  spots: VerifiedSpot[];
  region: string;
  onBack: () => void;
}) {
  const regionSpots = useMemo(() => spots.filter((spot) => spot.region === region), [spots, region]);
  const [activeId, setActiveId] = useState(regionSpots[0]?.id ?? "");
  // 共有リンクで聖地が指定されていれば、その並びで始める。
  const [selectedIds, setSelectedIds] = useState(() => sharedSelection(options?.spots, regionSpots.map((spot) => spot.id), MAX_SPOTS)
    ?? regionSpots.map((spot) => spot.id).slice(0, MAX_SPOTS));
  const [visitDate, setVisitDate] = useState(todayInJapan);
  const [availableMinutes, setAvailableMinutes] = useState(180);
  const [stayMinutes, setStayMinutes] = useState<Record<string, number>>({});
  const [detours, setDetours] = useState<VerifiedDetour[]>([]);
  const [detourState, setDetourState] = useState<DetourState>({ status: "idle" });
  const [selectedDetourIds, setSelectedDetourIds] = useState<string[]>([]);
  const [result, setResult] = useState<ItineraryResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const requestVersion = useRef(0);
  const detourKey = useRef("");
  // おすすめの寄り道を自動で入れた聖地の組み合わせ。外した寄り道を勝手に戻さないために使う。
  const autoDetourKey = useRef("");
  const resultRef = useRef<HTMLElement | null>(null);
  const version = displayVersion(work.version);

  const active = regionSpots.find((spot) => spot.id === activeId) ?? regionSpots[0];
  const selectedSpots = regionSpots.filter((spot) => selectedIds.includes(spot.id));
  const selectedDetours = detours.filter((spot) => selectedDetourIds.includes(spot.id));
  const closedSpots = visitDate ? [...selectedSpots, ...selectedDetours].filter((spot) => isKnownClosed(spot, visitDate)) : [];
  const stayOf = (spot: VerifiedSpot) => stayMinutes[spot.id] ?? spot.stay_minutes;
  const invalidStays = [...selectedSpots, ...selectedDetours].filter((spot) => !Number.isInteger(stayOf(spot)) || stayOf(spot) < 5 || stayOf(spot) > 180);

  const problems: string[] = [];
  if (!selectedSpots.length) problems.push("巡る地点を1件以上選んでください。");
  if (!visitDate) problems.push("訪問日を選んでください。");
  else if (visitDate < todayInJapan()) problems.push("訪問日は今日以降の日付にしてください。");
  if (closedSpots.length) problems.push(`${closedSpots.map((spot) => spot.name).join("、")}は選んだ日が休業日です。日付か地点を変えてください。`);
  if (invalidStays.length) problems.push("滞在時間は5〜180分の範囲で入力してください。");
  const canCreate = problems.length === 0 && !creating;

  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [result]);

  // 地域の寄り道は、選んだ聖地の組み合わせごとに Gemini と Google マップから探す。
  async function searchDetours(spotIds: string[]): Promise<{ detours: VerifiedDetour[]; routable: boolean } | null> {
    const key = spotIds.join(",");
    detourKey.current = key;
    setDetourState({ status: "loading" });
    try {
      const response = await fetch("/api/detours", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workId: work.id, region, spotIds, visitDate, ...(options?.pin ? { pinPlaceId: options.pin } : {}) }) });
      const data = await response.json();
      if (detourKey.current !== key) return null;
      if (!response.ok) throw new Error(data.error || "寄り道候補を取得できませんでした。");
      const found: VerifiedDetour[] = Array.isArray(data.detours) ? data.detours : [];
      const routable = data.routable !== false;
      setDetours(found);
      setDetourState({ status: "ready", source: data.source, routable, pinned: data.pinned === "included" || data.pinned === "out-of-reach" ? data.pinned : "none" });
      return { detours: found, routable };
    } catch (error) {
      if (detourKey.current !== key) return null;
      detourKey.current = "";
      setDetourState({ status: "error", message: error instanceof Error ? error.message : "寄り道候補を取得できませんでした。" });
      return null;
    }
  }

  function resetDetours() {
    autoDetourKey.current = "";
    detourKey.current = "";
    setDetours([]);
    setSelectedDetourIds([]);
    setDetourState({ status: "idle" });
  }

  function invalidateResult() {
    requestVersion.current++;
    setCreating(false);
    setResult(null);
    setCreateError("");
  }

  async function requestItinerary(detourIds: string[]) {
    const courseIds = [...selectedIds, ...detourIds];
    const stays = Object.fromEntries(Object.entries(stayMinutes).filter(([id]) => courseIds.includes(id)));
    const response = await fetch("/api/itinerary", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workId: work.id, region, spotIds: selectedIds, detourIds, visitDate, availableMinutes, stayMinutes: stays }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "コースを作成できませんでした。");
    return data as ItineraryResult;
  }

  // detourIds を渡さないときは「コースを作る」ボタンから。初回はおすすめの寄り道を最初からコースに入れる。
  async function createCourse(detourIds?: string[]) {
    if (problems.length) return;
    const current = ++requestVersion.current;
    setCreating(true);
    setCreateError("");
    const key = selectedIds.join(",");
    let ids = detourIds ?? selectedDetourIds;
    let autoAdded = false;
    try {
      if (detourIds === undefined && autoDetourKey.current !== key) {
        const found = detourKey.current === key && detourState.status === "ready"
          ? { detours, routable: detourState.routable !== false } : await searchDetours(selectedIds);
        if (current !== requestVersion.current) return;
        autoDetourKey.current = key;
        if (found?.routable) {
          ids = pickRecommendedDetours(found.detours, visitDate, Math.min(MAX_DETOURS, 5 - selectedIds.length));
          autoAdded = ids.length > 0;
          setSelectedDetourIds(ids);
        }
      }
      let data: ItineraryResult;
      try {
        data = await requestItinerary(ids);
      } catch (error) {
        // 自動で入れた寄り道のせいで計算できないときは、寄り道なしのコースを出す。
        if (!autoAdded) throw error;
        ids = [];
        setSelectedDetourIds([]);
        data = await requestItinerary([]);
      }
      if (current === requestVersion.current) setResult(data);
    } catch (error) {
      if (current === requestVersion.current) {
        setResult(null);
        setCreateError(error instanceof Error ? error.message : "コースを作成できませんでした。時間をおいて再度お試しください。");
      }
    } finally { if (current === requestVersion.current) setCreating(false); }
  }

  function toggleSpot(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id)
      : current.length < MAX_SPOTS ? [...current, id] : current);
    resetDetours();
    invalidateResult();
  }

  function applyDetours(next: string[]) {
    if (next.length > MAX_DETOURS || next.length + selectedIds.length > 5) return;
    setSelectedDetourIds(next);
    if (result) void createCourse(next);
    else invalidateResult();
  }

  function toggleDetour(id: string) {
    applyDetours(selectedDetourIds.includes(id) ? selectedDetourIds.filter((item) => item !== id) : [...selectedDetourIds, id]);
  }

  const detourById = new Map(detours.map((spot) => [spot.id, spot]));
  const openDetours = detours.filter((spot) => !(visitDate && isKnownClosed(spot, visitDate)));
  const detourLimit = Math.min(MAX_DETOURS, 5 - selectedIds.length);
  const recommendedDetourIds = pickRecommendedDetours(detours, visitDate, detourLimit);
  const canAddDetours = detourState.status === "ready" && detourState.routable !== false;

  const margin = result ? availableMinutes - result.course.totalMinutes : 0;
  const statusView = result ? result.status === "over"
    ? { className: "is-over", label: `指定の${formatMinutes(availableMinutes)}を約${formatMinutes(-margin)}超えそうです`, detail: "地点を減らすか、使える時間を延ばしてください。" }
    : { className: "is-good", label: `${formatMinutes(availableMinutes)}以内に収まる目安です`, detail: `余裕は約${formatMinutes(Math.max(0, margin))}です。` } : null;
  const allWalking = Boolean(result && result.course.legs.length && result.course.legs.every((leg) => leg.mode === "walking"));
  const hasDetourInCourse = Boolean(result?.course.stops.some((spot) => spot.kind === "detour"));
  const checks = result ? [
    "当日の営業・立入条件を公式情報で確認する",
    "Googleマップで訪問日時を指定し、経路と便を確認する",
    "最初の地点までと、最後の地点からの移動は含んでいません",
    ...result.notices,
  ] : [];

  return (
    <section className="screen-section verified-map-screen">
      <button type="button" className="text-back" onClick={onBack}>← 作品一覧へ戻る</button>
      <div className="section-heading"><div>
        <p className="page-kicker"><span>{region}</span>{version ? <span>{version}</span> : null}</p>
        <h1>{work.title}</h1>
        <p>巡りたい聖地を最大{MAX_SPOTS}件選ぶと、訪問順・移動時間の目安と、途中で寄れる地域の食・文化スポットが分かります。</p>
      </div></div>

      <div className="step-heading">
        <h2>① 巡る聖地を選ぶ</h2>
        <span className="choose-count" role="status">{selectedIds.length}／{MAX_SPOTS}件</span>
      </div>
      {active ? <div className="verified-map-layout">
        <div className="verified-map-frame"><GoogleSpotMap spots={regionSpots} detours={detours} activeId={active.id} onSelect={setActiveId} fallback={<><iframe title={`${active.name}の地図`} src={embedUrl(active)} loading="lazy" referrerPolicy="no-referrer" /><small>地図 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a></small></>} /></div>
        <ol className="verified-spot-list" aria-label="聖地の一覧">{regionSpots.map((spot, index) => {
          const checked = selectedIds.includes(spot.id);
          const disabled = !checked && selectedIds.length >= MAX_SPOTS;
          return <li key={spot.id} className={`${active.id === spot.id ? "is-active" : ""}${checked ? " is-selected" : ""}${disabled ? " is-disabled" : ""}`}>
            <label className="spot-select">
              <input type="checkbox" checked={checked} onChange={() => { toggleSpot(spot.id); setActiveId(spot.id); }} disabled={disabled} />
              <span className="stop-number" aria-hidden="true">{index + 1}</span>
              <span className="spot-select-text"><strong>{spot.name}</strong>{spot.relationship_note ? <small>{spot.relationship_note}</small> : null}</span>
            </label>
            <details className="detail-disclosure spot-disclosure"><summary>注意・出典</summary><div className="disclosure-body">
              <p>{spot.access_note}</p>
              {spot.entrance_note ? <p>入口・集合場所：{spot.entrance_note}</p> : null}
              <p className="field-hint">ピンは施設の中心付近で、作品と同じ撮影場所とは限りません。{spot.source_checked_at ? `（出典確認日：${spot.source_checked_at}）` : ""}</p>
              <div className="disclosure-links"><button type="button" className="text-button" onClick={() => setActiveId(spot.id)}>地図の中心に表示</button><a href={mapsUrl(spot)} target="_blank" rel="noreferrer">Googleマップ ↗</a><a href={spot.source_url} target="_blank" rel="noreferrer">作品との関係の出典 ↗</a>{spot.coordinate_source_url ? <a href={spot.coordinate_source_url} target="_blank" rel="noreferrer">位置の出典 ↗</a> : null}{spot.official_url ? <a href={spot.official_url} target="_blank" rel="noreferrer">公式情報 ↗</a> : null}</div>
            </div></details>
          </li>;
        })}</ol>
      </div> : <p role="status">この地域には地図に表示できる聖地がありません。</p>}
      {selectedIds.length >= MAX_SPOTS && regionSpots.length > MAX_SPOTS ? <p className="field-hint">入れ替えるときは、選択中の聖地のチェックを外してください。</p> : null}

      <section className="verified-course-form" aria-labelledby="plan-form-heading">
        <h2 id="plan-form-heading">② 日にちと時間を決める</h2>
        <div className="verified-course-fields">
          <label>訪問日<input type="date" min={todayInJapan()} value={visitDate} onChange={(event) => { setVisitDate(event.target.value); invalidateResult(); }} />{visitDate ? <span className="field-hint">{formatDate(visitDate)}</span> : null}</label>
          <label>現地で使える時間<select value={availableMinutes} onChange={(event) => { setAvailableMinutes(Number(event.target.value)); invalidateResult(); }}>{DURATION_OPTIONS.map((minutes) => <option key={minutes} value={minutes}>{formatMinutes(minutes)}</option>)}</select><span className="field-hint">1か所目に着いてから、最後の場所を出るまで</span></label>
        </div>
        {selectedSpots.length ? <details className="detail-disclosure stay-disclosure"><summary>滞在時間を変える</summary><div className="verified-course-fields">{[...selectedSpots, ...selectedDetours].map((spot) => <label key={spot.id}>{spot.name}<span className="input-with-unit"><input type="number" inputMode="numeric" min="5" max="180" step="5" value={Number.isFinite(stayOf(spot)) ? stayOf(spot) : ""} onChange={(event) => { setStayMinutes((current) => ({ ...current, [spot.id]: event.target.value === "" ? Number.NaN : Number(event.target.value) })); invalidateResult(); }} />分</span></label>)}</div></details> : null}
        {options?.pin ? <p className="detour-included">「食・お店から探す」で選んだお店を、<b>寄り道</b>としてコースに入れます。</p> : null}
        <button className="primary-button" type="button" disabled={!canCreate} aria-describedby={problems.length ? "plan-problems" : undefined} onClick={() => void createCourse()}>{creating ? detourState.status === "loading" ? "地域の寄り道を探しています…" : "経路を調べています…" : "コースを作る"}</button>
        {problems.length ? <ul id="plan-problems" className="form-problems">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul> : null}
        {createError ? <p className="inline-error" role="alert">{createError}</p> : null}
      </section>

      {result && statusView ? <section ref={resultRef} className="verified-course-result" aria-live="polite" aria-labelledby="result-heading">
        <h2 id="result-heading">③ {formatDate(visitDate)}のコース案</h2>
        <div className={`status-card ${statusView.className}`}>
          <p className="status-total">約<b>{formatMinutes(result.course.totalMinutes)}</b></p>
          <strong>{statusView.label}</strong>
          <p>{statusView.detail}</p>
        </div>
        {hasDetourInCourse ? <p className="detour-included">聖地の区間の途中で、地元の味や文化にふれられる<b>寄り道</b>を入れています。不要なら「✕ 外す」で外せます。</p> : null}
        {detourState.pinned === "out-of-reach" ? <p className="field-hint">選んだお店は聖地から離れているため、コースには入れていません。</p> : null}

        <ol className="course-stops">{result.course.stops.map((spot, index) => {
          const leg = result.course.legs[index];
          const next = result.course.stops[index + 1];
          const longWalk = leg?.mode === "walking" && leg.walkingMeters !== null && leg.walkingMeters > LONG_WALK_METERS;
          const detour = spot.kind === "detour" ? detourById.get(spot.id) : undefined;
          // この区間（聖地と聖地の間）で寄りやすい、まだ選んでいない寄り道。
          const nearbyDetours = next && canAddDetours && selectedDetourIds.length < detourLimit ? openDetours.filter((item) => !selectedDetourIds.includes(item.id) && item.detour_slot?.kind === "between"
            && ((item.detour_slot.fromId === spot.id && item.detour_slot.toId === next.id) || (item.detour_slot.fromId === next.id && item.detour_slot.toId === spot.id))).slice(0, 2) : [];
          return <li key={spot.id} className={spot.kind === "detour" ? "is-detour" : undefined}>
            <span className="stop-number" aria-hidden="true">{index + 1}</span>
            <div className="course-stop-body">
              <strong>{spot.name}</strong>
              <span className="stop-meta">{detour ? <DetourBadge spot={detour} /> : null}滞在 約{result.stayMinutes[spot.id] ?? spot.stay_minutes}分
                {spot.kind === "detour" ? <a href={spot.maps_uri ?? mapsUrl(spot)} target="_blank" rel="noreferrer">地図 ↗</a> : null}
                {spot.kind === "detour" ? <button type="button" className="stop-remove" disabled={creating} onClick={() => toggleDetour(spot.id)} aria-label={`${spot.name}をコースから外す`}>✕ 外す</button> : null}</span>
              {detour?.local_feature ? <p className="detour-feature">{detour.local_feature}</p> : null}
              {spot.kind !== "detour" && spot.access_note ? <details className="detail-disclosure stop-disclosure"><summary>注意</summary><p>{spot.access_note}</p></details> : null}
              {leg && next ? <div className={`verified-leg${longWalk ? " is-long" : ""}`}>
                <LegSummary leg={leg} href={directionsUrl(spot, next, leg.mode)} />
                {longWalk ? <span className="leg-warning">歩く距離が長めです。バスやタクシーも検討してください。</span> : null}
                {leg.source === "registered" ? <a className="leg-source" href={leg.source_url} target="_blank" rel="noreferrer">移動時間の出典 ↗</a> : null}
                {nearbyDetours.length ? <div className="leg-detours"><span>途中で寄れる</span>{nearbyDetours.map((item) =>
                  <button type="button" key={item.id} disabled={creating || selectedDetourIds.length >= detourLimit} onClick={() => toggleDetour(item.id)}>＋ {item.name}<small>{DETOUR_CATEGORY_LABELS[item.category]}</small></button>)}</div> : null}
              </div> : null}
            </div>
          </li>;
        })}</ol>
        {allWalking && result.course.stops.length > 1 ? <a className="secondary-button" href={walkingRouteUrl(result.course.stops)} target="_blank" rel="noreferrer">この順番でGoogleマップを開く ↗</a> : null}
        <ShareCourse path={courseUrl(work.id, region, { spots: selectedIds, pin: options?.pin })} title={`${work.title}・${region}のコース`} />

        <details className="detail-disclosure result-disclosure"><summary>出発前の確認事項（{checks.length}件）</summary><div className="disclosure-body">
          <ul className="check-list">{checks.map((check) => <li key={check}>{check}</li>)}</ul>
        </div></details>
        <details className="detail-disclosure result-disclosure"><summary>時間の内訳と費用の目安</summary><div className="disclosure-body">
          <dl className="breakdown">
            <div><dt>滞在</dt><dd>{formatMinutes(result.course.stayMinutes)}</dd></div>
            <div><dt>移動</dt><dd>{formatMinutes(result.course.moveMinutes)}</dd></div>
            <div><dt>余裕時間</dt><dd>{formatMinutes(result.course.bufferMinutes)}</dd></div>
            <div className="breakdown-total"><dt>合計</dt><dd>{formatMinutes(result.course.totalMinutes)}</dd></div>
          </dl>
          <dl className="breakdown">
            <div><dt>運賃</dt><dd>{formatYen(result.costs.transitYen)}</dd></div>
            <div><dt>入場料</dt><dd>{formatYen(result.costs.admissionYen)}</dd></div>
            {hasDetourInCourse ? <div><dt>寄り道の飲食・体験（下限）</dt><dd>{formatYen(result.costs.foodExperienceYen)}</dd></div> : null}
          </dl>
          <p className="field-hint">「不明」は0円として計算していません。移動時間は{result.source === "registered" ? "登録済みの区間データ" : "Googleの経路検索"}による目安です。</p>
        </div></details>
      </section> : null}

      {result ? <section className="verified-detours" aria-labelledby="detour-heading" aria-busy={detourState.status === "loading"}>
        <h2 id="detour-heading">④ 寄り道を入れ替える</h2>
        <p>聖地の区間の途中で寄れる、地元の味や文化にふれられる場所です。チェックを付け外しするとコースを作り直します（最大{MAX_DETOURS}件）。</p>
        {detourState.status === "loading" ? <p className="loading-note" role="status">寄り道を探しています…</p> : null}
        {detourState.status === "error" ? <div className="inline-error" role="alert"><p>{detourState.message}</p><button className="text-button" type="button" onClick={() => void searchDetours(selectedIds)}>もう一度探す</button></div> : null}
        {detourState.status === "ready" && !detours.length ? <p className="field-hint" role="status">条件に合う寄り道は見つかりませんでした。</p> : null}
        {detourState.status === "ready" && detourState.routable === false ? <p className="field-hint">移動時間を計算できないため、今はコースに追加できません。候補とGoogleマップは確認できます。</p> : null}
        {canAddDetours && recommendedDetourIds.length && !selectedDetourIds.length ? <button className="secondary-button" type="button" disabled={creating} onClick={() => applyDetours(recommendedDetourIds)}>おすすめの寄り道を入れる</button> : null}
        {detours.length ? <ul className="detour-list">{detours.map((spot) => {
          const closed = Boolean(visitDate && isKnownClosed(spot, visitDate));
          const checked = selectedDetourIds.includes(spot.id);
          return <DetourCard key={spot.id} spot={spot} checked={checked} closed={closed} visitDate={visitDate}
            disabled={!canAddDetours || creating || (!checked && (closed || selectedDetourIds.length >= detourLimit))} onToggle={() => toggleDetour(spot.id)} />;
        })}</ul> : null}
        {detours.length ? <DetourNote /> : null}
      </section> : null}
    </section>
  );
}
