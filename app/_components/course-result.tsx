"use client";

import { useMemo, useState } from "react";
import { evaluateCourse, isClosedOnDate, makeCandidates, type MockScenario, type Stop } from "../_data/mock-planner";
import type { Detour, Spot } from "../_data/mock-data";

type Props = {
  selectedSpots: Spot[];
  selectedDetours: string[];
  availableDetours: Detour[];
  toggleDetour: (detour: Detour) => void;
  conditions: { date: string; availableMinutes: number; durations: Record<string, number> };
  workTitle: string;
  regionLabel: string;
  onBack: () => void;
};

function formatMinutes(total: number | null) {
  if (total === null) return "算出不可";
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours ? `${hours}時間${minutes ? `${minutes}分` : ""}` : `${minutes}分`;
}

function mapsUrl(origin: string, destination: string, mode: "walking" | "transit") {
  return `https://www.google.com/maps/dir/?${new URLSearchParams({ api: "1", origin, destination, travelmode: mode }).toString()}`;
}

function spotMapsUrl(name: string) {
  return `https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query: name }).toString()}`;
}

function placementReason(stops: Stop[], index: number) {
  const before = stops[index - 1];
  const after = stops[index + 1];
  if (before && after) return `${before.name}と${after.name}の間に配置したデモ候補です。`;
  if (after) return `${after.name}の前に配置したデモ候補です。`;
  if (before) return `${before.name}の後に配置したデモ候補です。`;
  return "地域の寄り道候補です。";
}

export default function CourseResult({ selectedSpots, selectedDetours, availableDetours, toggleDetour, conditions, workTitle, regionLabel, onBack }: Props) {
  const [scenario, setScenario] = useState<MockScenario>("normal");
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const activeDetours = useMemo(() => availableDetours.filter((detour) => selectedDetours.includes(detour.id)), [availableDetours, selectedDetours]);
  const candidates = useMemo(
    () => makeCandidates(selectedSpots, activeDetours, conditions.durations),
    [selectedSpots, activeDetours, conditions.durations],
  );
  const closedPlaces = [...selectedSpots, ...activeDetours].filter((place) => isClosedOnDate(place, conditions.date));
  if (closedPlaces.length) {
    return <section className="screen-section result-section"><div className="reason-panel over"><h1>この日付ではコースを作成できません</h1><p>{closedPlaces.map((place) => place.name).join("、")}は登録済みの休業日です。訪問日を変更するか、寄り道を外してください。</p><button className="secondary-button" type="button" onClick={onBack}>訪問日と地点を見直す</button></div></section>;
  }
  const chosen = candidates.find((candidate) => candidate.id === candidateId) ?? candidates[0];
  if (!chosen) {
    return <section className="screen-section result-section"><div className="reason-panel over"><h1>コースを作成できませんでした</h1><p>地点数または選択内容を確認してください。聖地と寄り道は合計5件までです。</p><button className="secondary-button" type="button" onClick={onBack}>条件を変更する</button></div></section>;
  }
  const bestMoveMinutes = candidates[0].moveMinutes;
  const bestIsTied = candidates[1]?.moveMinutes === bestMoveMinutes;
  const course = evaluateCourse(chosen, conditions.date, conditions.availableMinutes, scenario, candidates);
  const statusClass = course.status === "目安では収まる" ? "good" : course.status === "要確認" ? "caution" : course.status === "計算できない" ? "unknown" : "over";
  const costTotal = course.transportCost + course.facilityCost + course.detourCost;

  return (
    <section className="screen-section result-section">
      <button className="text-back" type="button" onClick={onBack}>← 条件を変更する</button>
      <div className="result-hero">
        <div className="result-title"><span className="section-kicker">YOUR COURSE</span><h1>{workTitle}<br />{regionLabel}周遊コース</h1><p>訪問日 {conditions.date.replaceAll("-", ".")} ・ 訪問地点間のみの周遊</p></div>
        <div className={`judgement-card ${statusClass}`} aria-live="polite"><span>コース判定</span><strong>{course.status}</strong><p>{course.difference === null ? "経路が不明なため時間差は算出できません" : course.difference >= 0 ? `指定時間まで約${course.difference}分の余裕` : `指定時間を約${Math.abs(course.difference)}分超過`}</p></div>
      </div>
      <div className="summary-strip"><div><span>現地での周遊時間の目安</span><strong>{formatMinutes(course.totalMinutes)}</strong></div><div><span>訪問地点</span><strong>{chosen.stops.length}件</strong></div><div><span>地点間の移動</span><strong>{formatMinutes(course.moveMinutes)}</strong></div><div><span>指定した周遊時間</span><strong>{formatMinutes(conditions.availableMinutes)}</strong></div></div>
      <p className="course-scope">最初の地点までと最後の地点からの移動は含みません。訪問時刻、乗車便、帰着時刻は判定していません。移動・費用はフロントエンド用のデモ値です。</p>

      <div className="scenario-panel"><div><span className="section-kicker">DEMO CHECK</span><h2>結果の状態を試す</h2><p>バックエンド接続前に、通常・情報不足・経路失敗の表示を確認できます。</p></div><label>モック状態<select value={scenario} onChange={(event) => setScenario(event.target.value as MockScenario)}><option value="normal">通常のデモ計算</option><option value="missing_data">営業情報・一部運賃が不足</option><option value="route_error">主要区間の経路取得失敗</option></select></label></div>

      <div className={`reason-panel ${statusClass}`} aria-live="polite"><h2>判定の理由・確認事項</h2><ul>{course.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>{course.status !== "目安では収まる" ? <button className="secondary-button" type="button" onClick={onBack}>条件を変更する</button> : null}</div>

      {candidates.length > 1 ? <div className="candidate-panel"><div><span className="section-kicker">ROUTE OPTIONS</span><h2>訪問順の候補</h2><p>地点間のデモ移動時間が短い上位候補です。同時間なら聖地を先に置く案を先に表示します。必須聖地はすべて含みます。</p></div><div className="candidate-list">{candidates.slice(0, 3).map((candidate, index) => <button key={candidate.id} type="button" className={candidate.id === chosen.id ? "is-selected" : ""} aria-pressed={candidate.id === chosen.id} onClick={() => setCandidateId(candidate.id)}><span>{index === 0 ? bestIsTied ? "移動最短・同率" : "移動最短" : candidate.moveMinutes === bestMoveMinutes ? "同率候補" : `候補 ${index + 1}`}</span><strong>{candidate.stops.map((stop) => stop.name).join(" → ")}</strong><small>地点間の移動（デモ） {scenario === "route_error" ? "経路未取得" : formatMinutes(candidate.moveMinutes)}</small></button>)}</div></div> : null}

      <div className="result-layout"><div className="course-column"><div className="content-heading"><div><span className="section-kicker">ITINERARY</span><h2>訪問順と区間</h2></div><span className="recalculated">モック再計算済み</span></div><div className="timeline">
        {chosen.stops.map((stop, index) => { const leg = course.candidate.legs[index]; return <div className="timeline-group" key={stop.id}><article className={`timeline-stop ${stop.kind === "sacred" ? "sacred" : "detour"}`}><div className="timeline-time">{String(index + 1).padStart(2, "0")}</div><div className="timeline-dot">{stop.kind === "sacred" ? "✦" : "+"}</div><div className="timeline-content"><span className="stop-type">{stop.kind === "sacred" ? "作品の聖地・必須" : "地域の寄り道"}</span><h3>{stop.name}</h3><p>{stop.note}</p>{stop.kind === "detour" ? <p>{placementReason(chosen.stops, index)}</p> : null}<span className="stay-time">滞在 {stop.stayMinutes}分</span><dl className="stop-facts"><div><dt>通常営業時間</dt><dd>{scenario === "missing_data" && index === 0 ? "不明（デモ設定）" : stop.hours}</dd></div><div><dt>最終入場</dt><dd>{stop.lastEntry}</dd></div><div><dt>料金</dt><dd>{stop.fee === null ? "不明・合計対象外" : stop.fee === 0 ? "無料" : `${stop.fee.toLocaleString()}円${stop.kind === "detour" ? "〜（参考）" : ""}`}</dd></div><div><dt>予約</dt><dd>{stop.reservation}</dd></div><div><dt>出典・確認日</dt><dd>{stop.sourceLabel}・{stop.sourceDate}</dd></div></dl><div className="stop-links"><a href={spotMapsUrl(stop.name)} target="_blank" rel="noreferrer">地点をGoogleマップで開く ↗</a>{stop.officialUrl.startsWith("https://example.com/") ? <span>公式URL：デモ用の仮URL（未接続）</span> : <a href={stop.officialUrl} target="_blank" rel="noreferrer">公式情報を見る ↗</a>}</div></div></article>{leg ? <div className="timeline-leg"><span className="leg-line" /><div className="leg-detail"><span>{leg.mode === "walking" ? "徒歩" : "電車・バス（デモ）"} {leg.minutes === null ? "経路未取得" : `約${leg.minutes}分`} {leg.walkingMeters !== null ? `・徒歩約${leg.walkingMeters}m` : ""}</span><a href={mapsUrl(leg.from.name, leg.to.name, leg.mode)} target="_blank" rel="noreferrer">この区間をGoogleマップで確認 ↗</a></div></div> : null}</div>; })}
      </div><div className="breakdown-card"><h3>現地での周遊時間の内訳</h3><div><span>各地点での滞在</span><strong>{formatMinutes(course.stayMinutes)}</strong></div><div><span>地点間の移動（デモ値）</span><strong>{formatMinutes(course.moveMinutes)}</strong></div><div><span>アプリが設ける余裕時間</span><strong>{formatMinutes(course.bufferMinutes)}</strong></div><div className="breakdown-total"><span>合計</span><strong>{formatMinutes(course.totalMinutes)}</strong></div><p>経路が未取得の場合、合計を0分として扱いません。待ち時間を別途二重計上していません。</p></div></div>
      <aside className="course-sidebar"><div className="sidebar-card"><div className="content-heading"><div><span className="section-kicker">LOCAL PICKS</span><h2>寄り道を追加</h2></div><span>{activeDetours.length}件追加中</span></div><p className="sidebar-intro">追加・削除すると訪問順、区間、時間、費用、判定を更新します。</p><div className="detour-list">{availableDetours.map((detour) => { const active = selectedDetours.includes(detour.id); const closed = isClosedOnDate(detour, conditions.date); const limit = selectedSpots.length + selectedDetours.length >= 5 && !active; return <article className={`detour-card ${active ? "is-added" : ""}`} key={detour.id}><div className="detour-top"><span className={`category category-${detour.id}`}>{detour.category}</span><span>{detour.stayMinutes}分</span></div><h3>{detour.name}</h3><p>{detour.description}</p><div className="detour-meta"><span>{detour.hours}・最終入場 {detour.lastEntry}</span><span>予約：{detour.reservation}</span></div><div className="detour-reason">{detour.reason}</div>{closed ? <p className="detour-closed">選択した訪問日は登録済みの休業日です</p> : null}<div className="detour-bottom"><span>{detour.priceLabel}</span><button type="button" onClick={() => toggleDetour(detour)} disabled={limit || (closed && !active)}>{active ? "削除" : closed ? "休業日のため追加不可" : "追加"}</button></div></article>; })}</div><p className="limit-note">聖地と寄り道を合わせて最大5件です。</p></div>
      <div className="sidebar-card cost-card"><span className="section-kicker">COST</span><h2>費用の目安</h2><div><span>地点間の交通費（デモ）</span><strong>{course.transportCost.toLocaleString()}円{course.unknownCosts.some((cost) => cost.includes("運賃")) ? "＋不明" : ""}</strong></div><div><span>施設料金</span><strong>{course.facilityCost.toLocaleString()}円</strong></div><div><span>飲食・体験の参考価格</span><strong>{activeDetours.length ? `${course.detourCost.toLocaleString()}円〜` : "今回は含まない"}</strong></div><div className="cost-total"><span>判明分の合計</span><strong>{costTotal.toLocaleString()}円〜</strong></div>{course.unknownCosts.length ? <p>未取得：{course.unknownCosts.join("、")}。合計には含みません。</p> : null}<p>最初の地点までと最後の地点からの交通費は含みません。</p></div></aside></div>

      <div className="important-notice"><div><h2>出発前に必ずご確認ください</h2><p>このコースは訪問順の下書きです。デモ用の架空地点・仮座標・仮の移動時間と費用を使っています。</p><ul><li>各区間のGoogleマップで訪問日時を指定し、実際の経路・入口を確認</li><li>施設・交通機関の正式な情報で営業・運行・料金を確認</li><li>予約が必要・推奨の地点は事前に手続き</li></ul></div></div>
      <details className="judgement-guide"><summary>4つのコース判定について</summary><div><p><b className="guide-good">目安では収まる</b> 取得できた区間の概算が指定時間内です。</p><p><b className="guide-caution">要確認</b> 重要な情報が不足、または余裕が少ない状態です。</p><p><b className="guide-over">目安でも収まらない</b> 周遊時間の概算が指定時間を超えます。</p><p><b className="guide-unknown">計算できない</b> 経路障害・データ不足など。訪問不可能とは限りません。</p></div></details>
    </section>
  );
}
