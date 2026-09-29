"use client";

import { useState } from "react";
import { DETOUR_CATEGORY_LABELS, type DetourCategory } from "../_data/local-detours";

type Result = {
  detour: { id: string; name: string; region: string; category: string; local_relevance: string; placeId: string | null; mapsUri: string | null; address: string | null };
  works: Array<{ workId: string; title: string }>;
};

const EXAMPLES = ["うに", "地酒", "和菓子", "郷土料理", "伝統工芸"];

/**
 * 「うに」「地酒」「和菓子」などで、聖地がある地域の地元の店・施設を探す。
 * 店を選んで聖地へ進むと、その店を寄り道に入れたコースを作る。
 */
export default function DetourSearch({ onOpen, openingKey }: { onOpen: (workId: string, region: string, pinPlaceId?: string) => void; openingKey: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [searched, setSearched] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function search(word: string) {
    const q = word.trim();
    if (!q || q.length > 40 || loading) return;
    setQuery(q);
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/detours/search?${new URLSearchParams({ q })}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "検索できませんでした。");
      setResults(Array.isArray(data.results) ? data.results : []);
      setSearched(q);
    } catch (fetchError) {
      setResults(null);
      setError(fetchError instanceof Error ? fetchError.message : "検索できませんでした。");
    } finally { setLoading(false); }
  }

  return <section className="detour-search-section" aria-labelledby="detour-search-heading">
    <form className="search-field detour-search-form" onSubmit={(event) => { event.preventDefault(); void search(query); }} role="search">
      <label htmlFor="detour-search" className="sr-only">食べたいもの・買いたいもの・体験したいこと</label>
      <input id="detour-search" type="search" enterKeyHint="search" autoComplete="off" maxLength={40} placeholder="例：うに／地酒／和菓子" value={query} onChange={(event) => setQuery(event.target.value)} />
      <button type="submit" disabled={loading || !query.trim()}>{loading ? "探しています…" : "探す"}</button>
    </form>
    <div className="example-chips" aria-label="キーワードの例">{EXAMPLES.map((word) =>
      <button type="button" key={word} disabled={loading} onClick={() => void search(word)}>{word}</button>)}</div>
    <p className="field-hint">食べたいもの・買いたいもの・体験したいことから、聖地がある地域の地元のお店や施設を探します。お店を選ぶと、そのお店に寄るコースを作れます。</p>

    <h2 id="detour-search-heading" className="sr-only">食・お店・施設の検索結果</h2>
    {loading ? <p className="loading-note" role="status">地域とお店を探しています…（10秒ほどかかることがあります）</p> : null}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {!loading && results && !results.length ? <div className="search-empty" role="status"><p><strong>「{searched}」に合うお店は見つかりませんでした。</strong></p><p>別の言葉（例：「海鮮」「酒蔵」「お土産」）や、地域名（例：「飛騨」）で試してください。</p></div> : null}
    {!loading && results?.length ? <div className="research-grid">{results.map(({ detour, works }) => (
      <article className="research-card detour-result" key={`${detour.id}|${detour.region}`}>
        <p className="work-version"><span className={`detour-badge is-${detour.category}`}>{DETOUR_CATEGORY_LABELS[detour.category as DetourCategory] ?? "地域の店"}</span>{detour.region}</p>
        <h3>{detour.name}</h3>
        {detour.local_relevance ? <p className="detour-result-text">{detour.local_relevance}</p> : null}
        {detour.address ? <p className="detour-result-address">{detour.address}</p> : null}
        {detour.mapsUri ? <a className="detour-result-map" href={detour.mapsUri} target="_blank" rel="noreferrer">Googleマップで見る ↗</a> : null}
        {works.length ? <div className="region-buttons">{works.slice(0, 3).map((work) => (
          <button type="button" key={work.workId} disabled={Boolean(openingKey)} onClick={() => onOpen(work.workId, detour.region, detour.placeId ?? undefined)}>
            <span className="region-name">{work.title}の聖地とめぐる</span>
            <span className="region-meta">{openingKey === `${work.workId}/${detour.region}` ? "読み込み中…" : <span aria-hidden="true" className="region-arrow">→</span>}</span>
          </button>
        ))}</div> : <p className="field-hint">この地域の聖地はまだ登録されていません。</p>}
      </article>
    ))}</div> : null}
    {!loading && results?.length ? <p className="detour-note">お店の情報の出典：Google マップ。地域の選定には AI（Gemini）を使っています。営業時間などは訪問前に公式情報で確認してください。</p> : null}
  </section>;
}
