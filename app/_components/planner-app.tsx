"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MatchedWork, VerifiedLeg, VerifiedSpot } from "../_data/anilist-types";
import type { ResearchCatalog, ResearchWork } from "../_data/research-works";
import { displayVersion, matchesGenre, workTypeLabel, type GenreFilter } from "../_data/work-genres";
import { courseUrl, readCourseUrl, type CourseOptions } from "../_data/course-url";
import AniListLookup from "./anilist-lookup";
import DetourSearch from "./detour-search";
import ResearchCourse from "./research-course";
import VerifiedSpotMap from "./verified-spot-map";

type VerifiedSelection = {
  work: MatchedWork;
  spots: VerifiedSpot[];
  legs: VerifiedLeg[];
  region: string;
  options?: CourseOptions;
};

type PublishedWork = MatchedWork & { category: string | null; spotCounts?: Record<string, number> };

const APP_TITLE = "まちぽ｜物語の場所から、まちを歩こう。";
const INITIAL_VISIBLE = 12;
const genreOptions: GenreFilter[] = ["すべて", "ドラマ", "アニメ", "映画"];

function normalizeSearch(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ja-JP").replace(/\s+/g, "");
}

function readUrl() {
  return readCourseUrl(window.location.search);
}

function SearchIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>;
}

function PinIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>;
}

export default function PlannerApp({ researchCatalog }: { researchCatalog: ResearchCatalog }) {
  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState<"works" | "detours">("works");
  const [genreFilter, setGenreFilter] = useState<GenreFilter>("すべて");
  const [selection, setSelection] = useState<VerifiedSelection | null>(null);
  const [researchSelection, setResearchSelection] = useState<{ work: ResearchWork; region: string; options?: CourseOptions } | null>(null);
  const [publishedWorks, setPublishedWorks] = useState<PublishedWork[]>([]);
  const [publishedStatus, setPublishedStatus] = useState<"loading" | "ready" | "error">("loading");
  const [openingKey, setOpeningKey] = useState("");
  const [openError, setOpenError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const listScroll = useRef(0);
  const publishedRef = useRef<PublishedWork[]>([]);

  const query = normalizeSearch(search.trim());
  const publishedById = useMemo(() => new Map(publishedWorks.map((work) => [work.id, work])), [publishedWorks]);

  // 地図・所要時間を出せる作品を先頭に並べる。
  const orderedWorks = useMemo(() => {
    const ready = researchCatalog.works.filter((work) => publishedById.has(work.id));
    const others = researchCatalog.works.filter((work) => !publishedById.has(work.id));
    return [...ready, ...others];
  }, [researchCatalog.works, publishedById]);

  const matchingWorks = orderedWorks.filter((work) =>
    matchesGenre(work, genreFilter) && normalizeSearch(`${work.title}${work.version ?? ""}${work.regions.join("")}`).includes(query),
  );
  const filtering = Boolean(query) || genreFilter !== "すべて";
  const visibleWorks = filtering || showAll ? matchingWorks : matchingWorks.slice(0, INITIAL_VISIBLE);
  const showAniList = [...search.trim()].length >= 2 && matchingWorks.length === 0 && (genreFilter === "すべて" || genreFilter === "アニメ");

  const showCourse = useCallback((title: string, region: string) => {
    document.title = `${title}・${region}｜まちぽ`;
    window.scrollTo({ top: 0 });
  }, []);

  const clearCourse = useCallback(() => {
    setSelection(null);
    setResearchSelection(null);
    document.title = APP_TITLE;
    const saved = listScroll.current;
    requestAnimationFrame(() => window.scrollTo({ top: saved }));
  }, []);

  const loadWork = useCallback(async (workId: string, region: string, options: CourseOptions = {}) => {
    setOpenError("");
    const work = researchCatalog.works.find((item) => item.id === workId);
    const published = publishedRef.current.find((item) => item.id === workId);
    if (published?.regions.includes(region)) {
      setOpeningKey(`${workId}/${region}`);
      try {
        const response = await fetch(`/api/spots?workId=${encodeURIComponent(workId)}`);
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.spots) || !data.spots.length) throw new Error(data.error || "地図に表示できる聖地がありません。");
        setResearchSelection(null);
        setSelection({ work: published, spots: data.spots, legs: data.legs, region, options });
        showCourse(published.title, region);
        return true;
      } catch (error) {
        setOpenError(error instanceof Error ? error.message : "聖地を取得できませんでした。時間をおいて再度お試しください。");
        return false;
      } finally { setOpeningKey(""); }
    }
    if (work?.regions.includes(region)) {
      setSelection(null);
      setResearchSelection({ work, region, options });
      showCourse(work.title, region);
      return true;
    }
    setOpenError("指定された作品・地域が見つかりませんでした。一覧から選び直してください。");
    return false;
  }, [researchCatalog.works, showCourse]);

  async function openWork(workId: string, region: string, options: CourseOptions = {}) {
    listScroll.current = window.scrollY;
    const opened = await loadWork(workId, region, options);
    if (opened) window.history.pushState({ machipo: true }, "", courseUrl(workId, region, options));
  }

  // 対応作品を取得したあと、共有URL・再読み込みで指定された画面を開く。
  useEffect(() => {
    const controller = new AbortController();
    function openFromUrl() {
      const target = readUrl();
      if (!target) return;
      void loadWork(target.workId, target.region, target.options).then((opened) => {
        if (!opened) window.history.replaceState(null, "", window.location.pathname);
      });
    }
    fetch("/api/works", { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("対応作品を取得できませんでした。");
      return response.json();
    }).then((data) => {
      const works: PublishedWork[] = Array.isArray(data.works) ? data.works : [];
      publishedRef.current = works;
      setPublishedWorks(works);
      setPublishedStatus("ready");
      openFromUrl();
    }).catch(() => {
      if (controller.signal.aborted) return;
      setPublishedStatus("error");
      openFromUrl();
    });
    return () => controller.abort();
    // 初回表示時だけ実行する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ブラウザの「戻る」「進む」に追従する。
  useEffect(() => {
    function onPopState() {
      const target = readUrl();
      if (target) void loadWork(target.workId, target.region, target.options);
      else clearCourse();
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [loadWork, clearCourse]);

  function backToList() {
    if ((window.history.state as { machipo?: boolean } | null)?.machipo) {
      window.history.back();
      return;
    }
    window.history.replaceState(null, "", window.location.pathname);
    clearCourse();
  }

  function goHome() {
    setSearch("");
    setGenreFilter("すべて");
    setShowAll(false);
    setOpenError("");
    listScroll.current = 0;
    if (selection || researchSelection) window.history.pushState(null, "", window.location.pathname);
    clearCourse();
  }

  function openAniListWork(work: MatchedWork, spots: VerifiedSpot[], legs: VerifiedLeg[], region: string) {
    listScroll.current = window.scrollY;
    setResearchSelection(null);
    setSelection({ work, spots, legs, region });
    window.history.pushState({ machipo: true }, "", courseUrl(work.id, region));
    showCourse(work.title, region);
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="brand" type="button" onClick={goHome} aria-label="まちぽ トップへ戻る">
          <span className="brand-mark"><Image src="/app-icon.png" alt="" width={56} height={50} priority /></span>
          <span><strong>まちぽ</strong><small>物語の場所から、まちを歩こう。</small></span>
        </button>
      </header>

      <main>
        {selection ? <VerifiedSpotMap key={`${selection.work.id}/${selection.region}/${selection.options?.pin ?? ""}/${selection.options?.spots?.join(",") ?? ""}`} work={selection.work} spots={selection.spots} region={selection.region} options={selection.options} onBack={backToList} /> : null}
        {!selection && researchSelection ? <ResearchCourse key={`${researchSelection.work.id}/${researchSelection.region}/${researchSelection.options?.pin ?? ""}/${researchSelection.options?.spots?.join(",") ?? ""}`} work={researchSelection.work} region={researchSelection.region} options={researchSelection.options} onBack={backToList} /> : null}
        {/* 一覧・検索結果は、コース画面を開いている間も残しておき、戻ったときにそのまま見られるようにする。 */}
        <div hidden={Boolean(selection || researchSelection)}>
          <section className="screen-section intro-section">
            <h1><span>あの物語の場所から、</span><span><em>まちの魅力</em>へ。</span></h1>
            <p className="lead">好きな作品の聖地と、その間で寄れる地元の味・文化スポットをつないだコースを作れます。食べたいもの・買いたいものから探すこともできます。</p>

            <div className="search-mode-tabs" role="tablist" aria-label="探し方">
              <button type="button" role="tab" aria-selected={searchMode === "works"} className={searchMode === "works" ? "is-active" : ""} onClick={() => setSearchMode("works")}>作品から探す</button>
              <button type="button" role="tab" aria-selected={searchMode === "detours"} className={searchMode === "detours" ? "is-active" : ""} onClick={() => setSearchMode("detours")}>食・お店から探す</button>
            </div>

            {searchMode === "detours" ? <DetourSearch onOpen={(workId, region, pin) => void openWork(workId, region, { pin })} openingKey={openingKey} /> : <>
            <div className="search-panel">
              <label htmlFor="work-search">作品名や地域から探す</label>
              <div className="search-controls">
                <div className="search-field"><SearchIcon /><input id="work-search" type="search" enterKeyHint="search" autoComplete="off" placeholder="例：あまちゃん／飛騨市" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
                <div className="genre-filters" role="group" aria-label="作品の種類で絞り込み">{genreOptions.map((genre) => <button key={genre} type="button" aria-pressed={genreFilter === genre} className={genreFilter === genre ? "is-active" : ""} onClick={() => setGenreFilter(genre)}>{genre}</button>)}</div>
              </div>
            </div>

            <section className="research-section" aria-labelledby="work-list-heading">
              <div className="list-heading">
                <h2 id="work-list-heading">{filtering ? "検索結果" : "作品一覧"}</h2>
                <span className="result-count" role="status">{filtering ? `${matchingWorks.length}作品` : `全${researchCatalog.works.length}作品`}</span>
              </div>
              {publishedStatus === "error" ? <p className="catalog-notice" role="status">現在、移動時間の計算に対応した作品を読み込めません。聖地の一覧と寄り道探しは使えます。</p> : null}
              {openError ? <p className="inline-error" role="alert">{openError}</p> : null}
              {matchingWorks.some((work) => publishedById.has(work.id)) ? <p className="list-legend"><span className="ready-badge">所要時間つき</span>の地域は、移動時間の目安まで計算できます。</p> : null}

              {visibleWorks.length ? <div className="research-grid">{visibleWorks.map((work) => {
                const published = publishedById.get(work.id);
                const version = displayVersion(work.version);
                return <article className={`research-card${published ? " is-ready" : ""}`} key={work.id}>
                  <h3>{work.title}</h3>
                  <p className="work-version"><span className="work-type">{workTypeLabel(work)}</span>{version ? `・${version}` : ""}</p>
                  <div className="region-buttons">{work.regions.map((region) => {
                    const ready = Boolean(published?.regions.includes(region));
                    const count = ready ? published?.spotCounts?.[region] : work.region_counts[region];
                    const key = `${work.id}/${region}`;
                    const opening = openingKey === key;
                    return <button type="button" key={region} className={ready ? "is-ready" : ""} disabled={Boolean(openingKey)} onClick={() => openWork(work.id, region)} aria-label={`${work.title}・${region}のコースを作る`}>
                      <span className="region-name"><PinIcon />{region}</span>
                      <span className="region-meta">{opening ? "読み込み中…" : <>{ready ? <span className="ready-badge">所要時間つき</span> : null}{count ? `${count}地点` : null}<span aria-hidden="true" className="region-arrow">→</span></>}</span>
                    </button>;
                  })}</div>
                </article>;
              })}</div> : null}

              {filtering && matchingWorks.length === 0 ? <div className="search-empty">
                <p><strong>{search.trim() ? `「${search.trim()}」に一致する作品・地域はまだありません。` : "この種類の作品はまだありません。"}</strong></p>
                <p>作品名の一部だけや、市町村名で探してみてください。</p>
                <button className="text-button" type="button" onClick={() => { setSearch(""); setGenreFilter("すべて"); }}>条件をクリアする</button>
              </div> : null}
              {showAniList ? <AniListLookup key={search} query={search} onOpenMap={openAniListWork} /> : null}

              {!filtering && matchingWorks.length > visibleWorks.length ? <button className="more-button" type="button" onClick={() => setShowAll(true)}>すべての作品を見る（全{matchingWorks.length}作品）</button> : null}
            </section>
            </>}
            {searchMode === "detours" && openError ? <p className="inline-error" role="alert">{openError}</p> : null}

            <details className="detail-disclosure scope-disclosure"><summary>コースの作り方と注意点</summary><div className="disclosure-body">
              <p>作品と地域を選び、巡りたい聖地を最大3件選ぶと、訪問順の案を作ります。聖地の間や前後で寄れる地元の味・文化スポットは、AI（Gemini）がGoogleマップの情報から探します。</p>
              <p><strong>所要時間つきの地域</strong>では、訪問日と使える時間から移動時間の目安も計算します。それ以外の地域では、各区間の移動をGoogleマップで確認してください。</p>
              <p>学校・住宅地・施設の敷地には許可なく立ち入らず、出発前に公式情報とGoogleマップで確認してください。</p>
            </div></details>
          </section>
        </div>
      </main>

      <footer><div><Image src="/app-icon.png" alt="" width={38} height={34} /><strong>まちぽ</strong></div><p>物語とまちを、やさしくつなぐ。</p><small>訪問前に各施設の公式情報と当日の経路をご確認ください。</small></footer>
    </div>
  );
}
