import previewSpots from "./research-spots-preview.json";
import oshiWakuSpots from "./oshiwaku-spots-preview.json";

export type ResearchSpot = {
  id: string;
  workId: string;
  name: string;
  region: string;
  granularity: string;
  relationship: string;
  sourceUrl: string;
  sourceStage: string;
  listingUrl?: string;
};

export function researchSpotsForWork(workId: string): ResearchSpot[] {
  return [...previewSpots, ...oshiWakuSpots].filter((spot) => spot.workId === workId);
}
