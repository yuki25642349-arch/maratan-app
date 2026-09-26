import PlannerApp from "./_components/planner-app";
import { loadResearchWorks } from "./_data/research-works";

export default async function Home() {
  const researchCatalog = await loadResearchWorks();
  return <PlannerApp researchCatalog={researchCatalog} />;
}
