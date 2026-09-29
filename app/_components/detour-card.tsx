"use client";

import type { VerifiedDetour } from "../_data/anilist-types";
import { DETOUR_CATEGORY_LABELS, openingHoursTextFor } from "../_data/local-detours";
import { isKnownClosed } from "../_data/real-planner";

/**
 * 最初からコースに入れる寄り道。候補は聖地の区間の途中にある順に並んでいるので、
 * 食と文化の両方にふれられるよう、休業日でないものから1件ずつ選ぶ。
 */
export function pickRecommendedDetours(detours: readonly VerifiedDetour[], visitDate: string, limit: number) {
  const open = detours.filter((spot) => !isKnownClosed(spot, visitDate));
  // 「食・お店から探す」で選んだ店があれば最優先にし、残りで食と文化の両方がそろうようにする。
  const pinned = open.find((spot) => spot.pinned);
  const needFood = !pinned || pinned.category !== "food";
  return [pinned, needFood ? open.find((spot) => spot.category === "food" && spot !== pinned) : open.find((spot) => spot.category !== "food" && spot !== pinned),
    open.find((spot) => spot.category !== "food" && spot !== pinned), ...open]
    .filter((spot): spot is VerifiedDetour => Boolean(spot)).map((spot) => spot.id)
    .filter((id, index, list) => list.indexOf(id) === index).slice(0, Math.max(0, limit));
}

export function detourMapsUrl(spot: VerifiedDetour) {
  return spot.maps_uri ?? `https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query: spot.name, query_place_id: spot.place_id })}`;
}

export function DetourBadge({ spot }: { spot: Pick<VerifiedDetour, "category"> }) {
  return <span className={`detour-badge is-${spot.category}`}>{DETOUR_CATEGORY_LABELS[spot.category]}</span>;
}

/** 寄り道の候補。初期表示は「何にふれられるか」と「どこで寄れるか」だけにし、詳細は開いて見る。 */
export default function DetourCard({ spot, checked, disabled, closed, visitDate, onToggle }: {
  spot: VerifiedDetour;
  checked: boolean;
  disabled: boolean;
  closed: boolean;
  visitDate: string;
  onToggle: () => void;
}) {
  const hours = openingHoursTextFor(spot.weekday_hours, visitDate);
  return <li className={`detour-card${checked ? " is-selected" : ""}${closed ? " is-closed" : ""}`}>
    <label className="detour-card-main">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} />
      <span className="detour-card-text">
        <span className="detour-card-title"><DetourBadge spot={spot} /><strong>{spot.name}</strong></span>
        {spot.local_feature ? <span className="detour-feature">{spot.local_feature}</span> : spot.pinned ? <span className="detour-feature">あなたが探したお店</span> : null}
        <small>滞在 約{spot.stay_minutes}分</small>
        {closed ? <small className="detour-closed">選んだ日は定休日の可能性があります</small> : null}
      </span>
    </label>
    {spot.review_summary ? <div className="review-summary">
      <p>{spot.review_summary.text}</p>
      <small>{spot.review_summary.disclosure}・<a href={spot.review_summary.reviewsUri} target="_blank" rel="noreferrer">クチコミを見る ↗</a>・<a href={spot.review_summary.flagUri} target="_blank" rel="noreferrer">報告</a></small>
    </div> : null}
    <details className="detail-disclosure detour-more">
      <summary>詳しく見る</summary>
      <div className="disclosure-body">
        {spot.detour_reason ? <p>{spot.detour_reason}</p> : null}
        {hours ? <p>営業時間（Googleマップ）：{hours}</p> : null}
        <div className="disclosure-links">
          <a href={detourMapsUrl(spot)} target="_blank" rel="noreferrer">Googleマップで見る ↗</a>
          {spot.official_url ? <a href={spot.official_url} target="_blank" rel="noreferrer">公式サイト ↗</a> : null}
        </div>
      </div>
    </details>
  </li>;
}

export function DetourNote() {
  return <p className="detour-note">紹介文はAIがGoogleマップの情報をもとに作成したもので、作品とは関係ありません。営業時間などは訪問前に公式情報で確認してください。</p>;
}
