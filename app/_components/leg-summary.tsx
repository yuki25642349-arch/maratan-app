import { modeLabel, showAlternative, type LegOption } from "../_data/transit-label";

type Leg = LegOption & { walkingMeters?: number | null; fareYen?: number | null; alternative?: LegOption | null };

function duration(total: number) {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return `${minutes}分`;
  return minutes ? `${hours}時間${minutes}分` : `${hours}時間`;
}

function distance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${Math.round(meters / 10) * 10}m`;
}

/** 区間の移動を「バスで約12分・約200円（徒歩なら約25分）」の形で1〜2行に表示する。 */
export default function LegSummary({ leg, href }: { leg: Leg; href: string }) {
  const main = leg.mode === "walking" ? `徒歩 約${duration(leg.minutes)}` : `${modeLabel(leg.mode, leg.transitKind)}で約${duration(leg.minutes)}`;
  const alternative = showAlternative(leg, leg.alternative) ? leg.alternative! : null;
  return <>
    <div className="leg-line">
      <span className={`leg-mode is-${leg.mode === "walking" ? "walk" : leg.transitKind ?? "transit"}`}><b>{main}</b>
        {leg.mode === "walking" && leg.walkingMeters ? `・${distance(leg.walkingMeters)}` : ""}
        {leg.mode === "transit" && leg.fareYen ? `・約${leg.fareYen.toLocaleString()}円` : ""}</span>
      <a href={href} target="_blank" rel="noreferrer">経路 ↗</a>
    </div>
    {alternative ? <span className="leg-alt">{alternative.mode === "walking" ? "徒歩" : modeLabel(alternative.mode, alternative.transitKind)}なら約{duration(alternative.minutes)}</span> : null}
  </>;
}
