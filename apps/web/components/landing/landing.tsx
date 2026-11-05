import { LandingConnect } from "./connect";
import { LandingExplorer } from "./explorer";
import { LandingHero } from "./hero";
import { LandingNav } from "./nav";
import { LandingOutro } from "./outro";
import { LandingPipeline } from "./pipeline";
import { Reveal } from "./reveal";

export function Landing({ mcpUrl }: { mcpUrl: string }) {
  return (
    <div className="tl">
      <LandingNav />
      <LandingHero />
      <LandingPipeline />
      <LandingExplorer />
      <LandingConnect mcpUrl={mcpUrl} />
      <LandingOutro />
      <Reveal />
    </div>
  );
}
