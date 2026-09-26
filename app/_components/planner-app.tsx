"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { MatchedWork, VerifiedLeg, VerifiedSpot } from "../_data/anilist-types";
import type { ResearchCatalog } from "../_data/research-works";
import AniListLookup from "./anilist-lookup";
import VerifiedSpotMap from "./verified-spot-map";

type VerifiedSelection = {
  work: MatchedWork;
  spots: VerifiedSpot[];
  legs: VerifiedLeg[];
  region: string;
};

function normalizeSearch(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ja-JP").replace(/\s+/g, "");
}

function SearchIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>;
}

function PinIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>;
}

export default function PlannerApp({ researchCatalog }: { researchCatalog: ResearchCatalog }) {
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<VerifiedSelection | null>(null);
  const [publishedWorks, setPublishedWorks] = useState<(MatchedWork & { category: string | null })[]>([]);
  const [publishedError, setPublishedError] = useState(false);
  const [openingWorkId, setOpeningWorkId] = useState("");
  const [openError, setOpenError] = useState("");
  const query = normalizeSearch(search.trim());
  const matchingWorks = researchCatalog.works.filter((work) =>
    normalizeSearch(`${work.title}${work.regions.join("")}`).includes(query),
  );
  const visibleWorks = query ? matchingWorks : matchingWorks.slice(0, 12);
  const matchingPublished = publishedWorks.filter((work) => normalizeSearch(`${work.title}${work.regions.join("")}`).includes(query));

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/works", { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("対応作品を取得できませんでした。");
      return response.json();
    }).then((data) => setPublishedWorks(Array.isArray(data.works) ? data.works : []))
      .catch(() => { if (!controller.signal.aborted) setPublishedError(true); });
    return () => controller.abort();
  }, []);

  async function openPublishedWork(work: MatchedWork, requestedRegion: string) {
    setOpeningWorkId(work.id);
    setOpenError("");
    try {
      const response = await fetch(`/api/spots?workId=${encodeURIComponent(work.id)}`);
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.spots) || !data.spots.length) throw new Error(data.error || "確認済み聖地がありません。");
      const region = requestedRegion;
      setSelection({ work, spots: data.spots, legs: data.legs, region });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : "聖地を取得できませんでした。");
    } finally { setOpeningWorkId(""); }
  }

  function backToSearch() {
    setSelection(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function reset() {
    setSearch("");
    backToSearch();
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="brand" type="button" onClick={reset} aria-label="まちぽ ホームへ戻る">
          <span className="brand-mark"><Image src="/app-icon.png" alt="" width={548} height={494} priority /></span>
          <span><strong>まちぽ</strong><small>物語の場所から、まちを歩こう。</small></span>
        </button>
        <div className="availability-badge"><span /> 確認済み地点から対応</div>
      </header>

      <nav className="stepper" aria-label="コース作成の進み具合">
        <button type="button" className={`step-item ${selection ? "is-complete" : "is-active"}`} onClick={backToSearch} aria-current={!selection ? "step" : undefined}>
          <span className="step-number">{selection ? "✓" : "1"}</span><span className="step-label">作品・地域</span>
        </button>
        <button type="button" className={`step-item ${selection ? "is-active" : ""}`} disabled={!selection} aria-current={selection ? "step" : undefined}>
          <span className="step-number">2</span><span className="step-label">聖地・コース</span>
        </button>
      </nav>

      <main>
        {selection ? (
          <VerifiedSpotMap work={selection.work} spots={selection.spots} region={selection.region} onBack={backToSearch} />
        ) : (
          <section className="screen-section intro-section">
            <div className="eyebrow">✦ COURSE PLANNER</div>
            <h1>あの物語の場所から、<br /><em>まちの魅力</em>へ。</h1>
            <p className="lead">作品を探し、確認済みの聖地を選んでまちを歩く。訪問地点間の移動に根拠がある作品では、周遊の順番と時間の目安を提案します。</p>
            <div className="search-panel">
              <label htmlFor="work-search">作品名や地域から探す</label>
              <div className="search-field"><SearchIcon /><input id="work-search" type="search" placeholder="例：君の名は。、飛騨市" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
            </div>
            <AniListLookup key={search} query={search} hasLocalMatches={matchingWorks.length > 0} onOpenMap={(work, spots, legs, region) => {
              setSelection({ work, spots, legs, region });
              window.scrollTo({ top: 0, behavior: "smooth" });
            }} />

            <section className="research-section" aria-label="コースに進める作品">
              <div className="section-heading compact-heading"><div><span className="section-kicker">READY TO EXPLORE</span><h2>確認済みの作品・地域</h2><p>聖地を確認済みの作品だけを表示します。アニメ以外もここから選べます。</p></div><span className="result-count">{matchingPublished.length}作品</span></div>
              {publishedError ? <p role="alert" className="search-empty">対応作品を取得できませんでした。時間をおいて再試行してください。</p> : null}
              {openError ? <p role="alert" className="search-empty">{openError}</p> : null}
              <div className="research-grid">{matchingPublished.map((work) => <article className="research-card" key={work.id}><div className="research-card-top"><span>{work.category ?? "作品"}</span><span>聖地確認済み</span></div><h3>{work.title}</h3><p><PinIcon /> 巡る地域を選択</p><div className="published-regions">{work.regions.map((region) => <button type="button" key={region} disabled={openingWorkId === work.id} onClick={() => openPublishedWork(work, region)}>{openingWorkId === work.id ? "読み込み中…" : `${region} →`}</button>)}</div></article>)}</div>
              {!publishedError && publishedWorks.length > 0 && matchingPublished.length === 0 ? <p className="search-empty">この検索語に対応する作品・地域はありません。</p> : null}
            </section>

            <section className="research-section" aria-label="聖地リストから探す">
              <div className="section-heading compact-heading"><div><span className="section-kicker">聖地リスト</span><h2>調査中の作品も探す</h2><p>この一覧は調査段階の資料です。コースに進める作品・地域は上の「確認済みの作品・地域」で選べます。</p></div><span className="result-count">{query ? `${matchingWorks.length}作品が一致` : `全${researchCatalog.works.length}作品`}</span></div>
              {researchCatalog.source === "csv-preview" ? <p className="catalog-notice" role="status">現在はCSVのプレビューを表示しています。Supabaseの作品DBを読み込めないため、実コースへの照合は利用できません。</p> : null}
              {researchCatalog.error ? <p className="search-empty" role="status">Supabaseからの読み込みに失敗しました。CSVプレビューで検索できます。</p> : null}
              <div className="research-grid">{visibleWorks.map((work) => <article className="research-card" key={work.id}>
                <div className="research-card-top"><span>{work.category ?? "作品"}{work.version ? `・${work.version}` : ""}</span><span>調査リスト</span></div>
                <h3>{work.title}</h3>
                <p><PinIcon /> {work.regions.join("、") || "地域確認中"}</p>
                <small>CSV掲載地点 {work.spot_count}件・未確認地点はコース対象外</small>
              </article>)}</div>
              {!researchCatalog.error && query && matchingWorks.length === 0 ? <p className="search-empty">聖地リストに一致する作品・地域はありません。</p> : null}
              {!query && matchingWorks.length > visibleWorks.length ? <p className="research-hint">作品名や都道府県・市区町村名を入力すると、全作品を検索できます。</p> : null}
            </section>
            <div className="scope-note"><p><strong>コース作成について</strong><br />CSVの調査地点はそのままコースに使いません。位置・訪問条件・地点間の移動時間を確認できた作品から対応します。</p></div>
          </section>
        )}
      </main>

      <footer><div><Image src="/app-icon.png" alt="" width={548} height={494} /><strong>まちぽ</strong></div><p>物語とまちを、やさしくつなぐ。</p><small>確認済みの作品・地点から順次対応しています。</small></footer>
    </div>
  );
}
