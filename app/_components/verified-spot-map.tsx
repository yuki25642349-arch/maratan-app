"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MatchedWork, VerifiedDetour, VerifiedLeg, VerifiedSpot } from "../_data/anilist-types";
import { isKnownClosed, type VerifiedCourse } from "../_data/real-planner";
import GoogleSpotMap from "./google-spot-map";

type ApiCourse = Omit<VerifiedCourse, "legs"> & { legs: (VerifiedLeg & { source: "google-routes" | "registered"; walkingMeters: number | null; fareYen: number | null })[] };
type ItineraryResult = { course: ApiCourse; recommendation: { id: string; reason: string; source: "gemini" | "rule" }; source: "google-routes" | "registered" | "mixed"; status: "fits" | "over" | "needs-check"; stayMinutes: Record<string, number>; costs: { transitYen: number | null; admissionYen: number | null; foodExperienceYen: number | null }; notices: string[] };

function embedUrl(spot: VerifiedSpot) {
  const padding = 0.008;
  const params = new URLSearchParams({
    bbox: `${spot.longitude - padding},${spot.latitude - padding},${spot.longitude + padding},${spot.latitude + padding}`,
    layer: "mapnik",
    marker: `${spot.latitude},${spot.longitude}`,
  });
  return `https://www.openstreetmap.org/export/embed.html?${params}`;
}

function mapsUrl(spot: VerifiedSpot) {
  return `https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query: `${spot.latitude},${spot.longitude}` })}`;
}

function directionsUrl(from: VerifiedSpot, to: VerifiedSpot, mode: VerifiedLeg["mode"]) {
  return `https://www.google.com/maps/dir/?${new URLSearchParams({
    api: "1", origin: `${from.latitude},${from.longitude}`,
    destination: `${to.latitude},${to.longitude}`, travelmode: mode,
  })}`;
}

function todayInJapan() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default function VerifiedSpotMap({ work, spots, region, onBack }: {
  work: MatchedWork;
  spots: VerifiedSpot[];
  region: string;
  onBack: () => void;
}) {
  const regionSpots = useMemo(() => spots.filter((spot) => spot.region === region), [spots, region]);
  const [activeId, setActiveId] = useState(regionSpots[0]?.id ?? "");
  const [selectedIds, setSelectedIds] = useState(regionSpots.map((spot) => spot.id).slice(0, 3));
  const [visitDate, setVisitDate] = useState("");
  const [availableMinutes, setAvailableMinutes] = useState(180);
  const [stayMinutes, setStayMinutes] = useState<Record<string, number>>({});
  const [detours, setDetours] = useState<VerifiedDetour[]>([]);
  const [detoursError, setDetoursError] = useState("");
  const [detoursAvailable, setDetoursAvailable] = useState(true);
  const [selectedDetourIds, setSelectedDetourIds] = useState<string[]>([]);
  const [visitChecked, setVisitChecked] = useState(false);
  const [result, setResult] = useState<ItineraryResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const requestVersion = useRef(0);
  const resultRef = useRef<HTMLElement | null>(null);
  const active = regionSpots.find((spot) => spot.id === activeId) ?? regionSpots[0];
  const selectedSpots = regionSpots.filter((spot) => selectedIds.includes(spot.id));
  const closedSpots = visitDate ? [...selectedSpots, ...detours.filter((spot) => selectedDetourIds.includes(spot.id))].filter((spot) => isKnownClosed(spot, visitDate)) : [];
  const validBudget = Number.isFinite(availableMinutes) && availableMinutes >= 30 && availableMinutes <= 720;
  const validStays = [...selectedSpots, ...detours.filter((spot) => selectedDetourIds.includes(spot.id))].every((spot) => Number.isInteger(stayMinutes[spot.id] ?? spot.stay_minutes) && (stayMinutes[spot.id] ?? spot.stay_minutes) >= 5 && (stayMinutes[spot.id] ?? spot.stay_minutes) <= 180);
  const canCreate = visitDate >= todayInJapan() && validBudget && validStays && visitChecked && closedSpots.length === 0 && selectedSpots.length > 0 && !creating;

  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [result]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/detours?region=${encodeURIComponent(region)}`, { signal: controller.signal }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "寄り道候補を取得できません。");
      setDetours(Array.isArray(data.detours) ? data.detours : []);
      setDetoursAvailable(data.available !== false);
    }).catch((error) => { if (!controller.signal.aborted) setDetoursError(error instanceof Error ? error.message : "寄り道候補を取得できません。"); });
    return () => controller.abort();
  }, [region]);

  async function createCourse(detourIds = selectedDetourIds) {
    if (!canCreate) return;
    const version = ++requestVersion.current;
    setCreating(true);
    setCreateError("");
    setResult(null);
    try {
      const response = await fetch("/api/itinerary", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workId: work.id, region, spotIds: selectedIds, detourIds, visitDate, availableMinutes, stayMinutes }) });
      const data = await response.json();
      if (!response.ok) throw new Error(`${data.status === "over" ? "目安でも収まらない：" : data.status === "unavailable" ? "計算できない：" : ""}${data.error || "コースを作成できませんでした。"}`);
      if (version === requestVersion.current) setResult(data as ItineraryResult);
    } catch (error) { if (version === requestVersion.current) setCreateError(error instanceof Error ? error.message : "コースを作成できませんでした。"); }
    finally { if (version === requestVersion.current) setCreating(false); }
  }

  function toggleSpot(id: string) {
    requestVersion.current++;
    setCreating(false);
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id)
      : current.length < 3 ? [...current, id] : current);
    setVisitChecked(false);
    setResult(null);
  }

  function toggleDetour(id: string) {
    const next = selectedDetourIds.includes(id) ? selectedDetourIds.filter((item) => item !== id) : [...selectedDetourIds, id];
    if (next.length > 2 || next.length + selectedIds.length > 5) return;
    setSelectedDetourIds(next);
    if (result && visitChecked) void createCourse(next);
    else { requestVersion.current++; setResult(null); }
  }

  return (
    <section className="screen-section verified-map-screen">
      <button type="button" className="text-back" onClick={onBack}>← 作品・地域の選択へ戻る</button>
      <div className="section-heading"><div><span className="section-kicker">確認済み聖地マップ</span><h1>{work.title}</h1><p>{region}で確認済みの聖地 {regionSpots.length}件。巡る地点を1～3件選んでください。</p></div></div>
      {active ? <div className="verified-map-layout">
        <div className="verified-map-frame"><GoogleSpotMap spots={regionSpots} activeId={active.id} onSelect={setActiveId} fallback={<><iframe title={`${active.name}の地図`} src={embedUrl(active)} loading="lazy" referrerPolicy="no-referrer" /><small>地図 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>（Google Maps JavaScript API用のブラウザキー未設定時）</small></>} /></div>
        <div className="verified-spot-list">{regionSpots.map((spot) => <article key={spot.id} className={active.id === spot.id ? "is-active" : ""}>
          <button type="button" onClick={() => setActiveId(spot.id)} aria-pressed={active.id === spot.id}><strong>{spot.name}</strong><span>地図で見る →</span></button>
          <label className="verified-select"><input type="checkbox" checked={selectedIds.includes(spot.id)} onChange={() => toggleSpot(spot.id)} disabled={!selectedIds.includes(spot.id) && selectedIds.length >= 3} /> コースに含める</label>
          <p>{spot.access_note}</p>
          {spot.relationship_note ? <p>作品との関係：{spot.relationship_note}</p> : <p>作品との関係の説明は未登録です。根拠資料を確認してください。</p>}
          {spot.entrance_note ? <p>入口・集合場所：{spot.entrance_note}</p> : null}
          {spot.source_checked_at ? <p>出典確認日：{spot.source_checked_at}</p> : null}
          <div><a href={mapsUrl(spot)} target="_blank" rel="noreferrer">Google マップ ↗</a><a href={spot.source_url} target="_blank" rel="noreferrer">作品・訪問の根拠 ↗</a>{spot.coordinate_source_url ? <a href={spot.coordinate_source_url} target="_blank" rel="noreferrer">座標の根拠 ↗</a> : null}{spot.notes?.includes("https://hida-lib.jp/") ? <a href="https://hida-lib.jp/toshow/html/access.html" target="_blank" rel="noreferrer">図書館の開館案内 ↗</a> : null}</div>
        </article>)}</div>
      </div> : <p role="status">この地域に確認済み聖地はありません。</p>}
      <p className="verified-map-note">座標は施設・駅舎の中心付近で、作品と同じ撮影視点とは限りません。調査中の地点は表示しません。</p>
      <section className="verified-course-form" aria-label="実データのコース条件">
        <div><span className="section-kicker">REAL COURSE</span><h2>確認済みデータでコースを作る</h2><p>訪問地点間だけを計算します。最初の地点までと最後の地点からの移動は含めません。</p></div>
        <div className="verified-course-fields"><label>訪問日<input type="date" min={todayInJapan()} value={visitDate} onChange={(event) => { requestVersion.current++; setCreating(false); setVisitDate(event.target.value); setVisitChecked(false); setResult(null); }} /></label><label>周遊に使える時間（分）<input type="number" min="30" max="720" step="15" value={Number.isFinite(availableMinutes) ? availableMinutes : ""} onChange={(event) => { requestVersion.current++; setCreating(false); setAvailableMinutes(event.target.value === "" ? Number.NaN : Number(event.target.value)); setResult(null); }} /></label></div>
        <div className="verified-stay-fields"><strong>各聖地の滞在時間</strong><div className="verified-course-fields">{selectedSpots.map((spot) => <label key={spot.id}>{spot.name}（分）<input type="number" min="5" max="180" step="5" value={stayMinutes[spot.id] ?? spot.stay_minutes} onChange={(event) => { requestVersion.current++; setCreating(false); setStayMinutes((current) => ({ ...current, [spot.id]: event.target.value === "" ? Number.NaN : Number(event.target.value) })); setResult(null); }} /></label>)}</div></div>
        {closedSpots.length ? <p className="verified-course-warning" role="status">{closedSpots.map((spot) => spot.name).join("、")}は選択日に登録済みの定例休館条件に当たります。日付を変えてください。祝日の例外・臨時休館は公式サイトで確認してください。</p> : null}
        <label className="verified-select verified-visit-check"><input type="checkbox" checked={visitChecked} onChange={(event) => { requestVersion.current++; setCreating(false); setVisitChecked(event.target.checked); setResult(null); }} /> 選んだ地点の当日の営業・立入条件を公式情報で確認しました</label>
        <button className="primary-button" type="button" disabled={!canCreate} onClick={() => void createCourse()}>{creating ? "経路を調べています…" : "この条件でコースを作る →"}</button>
        {createError ? <p className="verified-course-warning" role="alert">{createError}</p> : null}
      </section>
      {result || selectedDetourIds.length ? <section className="verified-detours" aria-label="寄り道候補"><h2>地域の寄り道</h2><p>確認済みの地域スポットを最大2件追加できます。追加・削除すると訪問順と区間移動を再計算します。</p>{detoursError ? <p role="status" className="verified-course-warning">{detoursError}</p> : null}{!detoursError && !detoursAvailable ? <p className="verified-map-note">寄り道機能はDB反映待ちです。基本コースは利用できます。</p> : null}{!detoursError && detoursAvailable && detours.length === 0 ? <p className="verified-map-note">この地域には、公開済みの寄り道候補がまだありません。</p> : null}<div className="verified-detour-list">{detours.map((spot) => { const closed = Boolean(visitDate && isKnownClosed(spot, visitDate)); return <div key={spot.id} className="verified-detour-item"><input id={`detour-${spot.id}`} type="checkbox" checked={selectedDetourIds.includes(spot.id)} disabled={creating || (!selectedDetourIds.includes(spot.id) && (closed || selectedDetourIds.length >= 2 || selectedIds.length + selectedDetourIds.length >= 5))} onChange={() => toggleDetour(spot.id)} /><span><label htmlFor={`detour-${spot.id}`}><strong>{spot.name}</strong></label><small>{spot.category}・滞在約{spot.stay_minutes}分</small><small>{spot.local_relevance}</small>{closed ? <small>選択日は登録済み休業日です。日付を変更してください。</small> : null}<a href={spot.source_url} target="_blank" rel="noreferrer">寄り道情報の出典 ↗</a></span></div>; })}</div></section> : null}
      {result ? <section ref={resultRef} className="verified-course-result" aria-live="polite"><span className="section-kicker">YOUR COURSE</span><h2>{work.title}・{region}の周遊案</h2><p>訪問日 {visitDate}　現地での周遊時間の目安 <strong>約{result.course.totalMinutes}分</strong>（滞在{result.course.stayMinutes}分＋地点間移動{result.course.moveMinutes}分＋余裕{result.course.bufferMinutes}分）</p><p className={result.status === "over" ? "verified-course-warning" : "verified-course-ok"}><strong>{result.status === "over" ? "目安でも収まらない" : result.status === "fits" ? "目安では収まる" : "要確認"}</strong>：{result.status === "over" ? `指定時間を約${result.course.totalMinutes - availableMinutes}分超える目安です。` : result.status === "fits" ? `指定時間内の概算です（余裕約${availableMinutes - result.course.totalMinutes}分）。当日の状況は別途確認してください。` : `時間の概算は指定内（残り約${availableMinutes - result.course.totalMinutes}分）ですが、営業・料金などに未確認項目があります。`}</p>
        <p>{result.recommendation.source === "gemini" ? "Geminiのおすすめ" : "コースの選択理由"}：{result.recommendation.reason}</p>
        <ol>{result.course.stops.map((spot, index) => { const leg = result.course.legs[index]; const next = result.course.stops[index + 1]; return <li key={spot.id}><strong>{spot.name}</strong><span>{spot.kind === "detour" ? "地域の寄り道" : "作品の聖地"}・滞在の目安 {result.stayMinutes[spot.id] ?? spot.stay_minutes}分</span><p>{spot.access_note}</p>{spot.notes ? <small>{spot.notes}</small> : null}{leg && next ? <div className="verified-leg">{leg.mode === "walking" ? "徒歩" : "公共交通"} 約{leg.minutes}分 · 徒歩距離 {leg.walkingMeters === null ? "不明" : `約${leg.walkingMeters}m`} · 区間運賃 {leg.fareYen === null ? "不明" : `${leg.fareYen}円`} <a href={directionsUrl(spot, next, leg.mode)} target="_blank" rel="noreferrer">この区間をGoogle マップで確認 ↗</a>{leg.source === "registered" ? <a href={leg.source_url} target="_blank" rel="noreferrer">移動時間の根拠 ↗</a> : <span>Google Routes APIの概算</span>}</div> : null}</li>; })}</ol>
        <div className="verified-costs"><strong>費用の目安（地点間の移動と訪問先のみ）</strong><p>区間運賃：{result.costs.transitYen === null ? "不明" : `${result.costs.transitYen}円`} ／施設料金：{result.costs.admissionYen === null ? "不明" : `${result.costs.admissionYen}円`} ／飲食・体験：{result.costs.foodExperienceYen === null ? "不明" : `${result.costs.foodExperienceYen}円`}</p><small>不明な費用を0円として合計していません。最初・最後の地点との往復交通費は対象外です。</small></div>
        {result.notices.map((notice) => <p className="verified-map-note" key={notice}>{notice}</p>)}
        <p className="verified-map-note">Googleマップ側で訪問日時を指定して、当日の便と経路を確認してください。外部地図の結果はアプリ内の概算と異なる場合があります。</p>
        <p className="verified-map-note">徒歩ルートには歩道などの情報が不完全な場合があります。訪問時刻を決めていないため、営業時間内に各地点へ到着できるかは判定していません。出発前に公式の営業・休館情報と各区間の経路を確認してください。</p>
      </section> : null}
    </section>
  );
}
