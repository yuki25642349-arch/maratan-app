"use client";

import { useEffect, useRef, useState } from "react";
import type { AniListMatch, AniListSuggestion, MatchedWork, VerifiedLeg, VerifiedSpot } from "../_data/anilist-types";

const FORMAT_LABELS: Record<string, string> = {
  TV: "TVアニメ",
  TV_SHORT: "短編アニメ",
  MOVIE: "映画",
  OVA: "OVA",
  ONA: "配信アニメ",
  SPECIAL: "特別編",
  MUSIC: "音楽作品",
};

function mediaTitle(media: AniListSuggestion) {
  return media.title.native || media.title.romaji || media.title.english || `AniList ID ${media.id}`;
}

export default function AniListLookup({ query, hasLocalMatches, onOpenMap }: {
  query: string;
  hasLocalMatches: boolean;
  onOpenMap: (work: MatchedWork, spots: VerifiedSpot[], legs: VerifiedLeg[], region: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<AniListSuggestion[]>([]);
  const [searchPhase, setSearchPhase] = useState<"idle" | "loading" | "ready" | "error">(
    [...query.trim()].length >= 2 ? "loading" : "idle",
  );
  const [searchError, setSearchError] = useState("");
  const [selected, setSelected] = useState<AniListSuggestion | null>(null);
  const [match, setMatch] = useState<AniListMatch | null>(null);
  const [matchPhase, setMatchPhase] = useState<"idle" | "loading" | "error">("idle");
  const [selectedRegion, setSelectedRegion] = useState("");
  const matchAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    if ([...query.trim()].length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/anilist/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "AniListの検索に失敗しました。");
        setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
        setSearchPhase("ready");
      } catch (error) {
        if (controller.signal.aborted) return;
        setSearchError(error instanceof Error ? error.message : "AniListの検索に失敗しました。");
        setSearchPhase("error");
      }
    }, 550);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  useEffect(() => () => matchAbort.current?.abort(), []);

  async function chooseMedia(media: AniListSuggestion) {
    matchAbort.current?.abort();
    const controller = new AbortController();
    matchAbort.current = controller;
    setSelected(media);
    setMatch(null);
    setSelectedRegion("");
    setMatchPhase("loading");
    try {
      const response = await fetch(`/api/anilist/match?id=${media.id}`, { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "作品DBとの照合に失敗しました。");
      setMatch(data as AniListMatch);
      setMatchPhase("idle");
    } catch {
      if (!controller.signal.aborted) setMatchPhase("error");
    }
  }

  if ([...query.trim()].length < 2) {
    return <p className="research-hint">アニメ名を2文字以上入力するとAniListから候補を取得します。地域名は下の聖地リストで検索できます。</p>;
  }

  const readySpots = match?.status === "ready" ? match.spots : [];
  const regions = [...new Set(readySpots.map((spot) => spot.region))];

  return (
    <section className="anilist-panel" aria-label="AniListのアニメ検索候補">
      <div className="anilist-heading"><strong>AniListのアニメ候補</strong><a href="https://anilist.co/" target="_blank" rel="noreferrer">候補提供: AniList</a></div>
      {searchPhase === "loading" ? <p className="anilist-status" role="status">アニメを検索しています…</p> : null}
      {searchPhase === "error" ? <p className="anilist-status error" role="alert">{searchError}</p> : null}
      {searchPhase === "ready" && suggestions.length === 0 ? <p className="anilist-status">AniListに候補がありません。{hasLocalMatches ? "地域の検索結果は下に表示しています。" : "別の作品名で検索してください。"}</p> : null}
      {suggestions.length > 0 ? <div className="anilist-options">{suggestions.map((media) => <button type="button" key={media.id} className={selected?.id === media.id ? "is-selected" : ""} aria-pressed={selected?.id === media.id} onClick={() => chooseMedia(media)}><span><strong>{mediaTitle(media)}</strong><small>{[media.format ? FORMAT_LABELS[media.format] ?? media.format : null, media.seasonYear ? `${media.seasonYear}年` : null, `AniList ID: ${media.id}`].filter(Boolean).join(" ・ ")}</small></span><span aria-hidden="true">→</span></button>)}</div> : null}
      {selected ? <div className="anilist-match" aria-live="polite">
        {matchPhase === "loading" ? <p>「{mediaTitle(selected)}」をアプリ内DBと照合しています…</p> : null}
        {matchPhase === "error" ? <p className="match-warning">作品DBとの照合に失敗しました。再度候補を選んでください。</p> : null}
        {match?.status === "unregistered" ? <p className="match-warning">このAniList IDに対応する作品は、まだアプリの作品DBに登録されていません。地域・聖地マップには進めません。</p> : null}
        {match?.status === "unverified" ? <p className="match-warning">「{match.work.title}」は作品DBに登録されていますが、座標と訪問条件を確認済みの聖地がありません。地域・聖地マップには進めません。</p> : null}
        {match?.status === "ready" ? <div className="anilist-ready"><strong>{match.work.title}：確認済み聖地 {readySpots.length}件</strong><p>巡る地域を選んでください。根拠のある移動区間が登録された地点では、実データのコースも作成できます。</p><div className="anilist-regions">{regions.map((region) => <button type="button" key={region} className={selectedRegion === region ? "is-selected" : ""} aria-pressed={selectedRegion === region} onClick={() => setSelectedRegion(region)}>{region}</button>)}</div><button type="button" className="primary-button" disabled={!selectedRegion} onClick={() => onOpenMap(match.work, readySpots, match.legs, selectedRegion)}>聖地マップへ進む →</button></div> : null}
      </div> : null}
    </section>
  );
}
