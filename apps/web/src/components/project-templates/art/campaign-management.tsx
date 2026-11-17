import { Target } from "lucide-react";
import { AccentBar, ArtFrame, Badge, Dot, Skeleton, Tick } from "./primitives";
import type { TemplateArtProps } from "./types";

/** Campaigns on a timeline: one finished, one live now, one still to come. */
export default function CampaignManagementArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={5} className={className}>
      <Skeleton.Timeline
        bars={[
          [0, 0.4],
          [0.28, 0.56],
          [0.55, 0.35],
          [0.12, 0.3],
        ]}
        h={170}
        highlight={1}
        today={0.68}
        w={250}
        x={20}
        y={50}
      />
      <AccentBar h={12} tone="soft" w={70.4} x={82} y={84} />
      <AccentBar h={12} tone="soft" w={61.6} x={178.8} y={128} />
      <Tick r={8} x={166} y={90} />
      <Dot r={5.5} tone="accent-7" x={222} y={112} />
      <Badge icon={Target} sparks="top-right" x={266} y={52} />
    </ArtFrame>
  );
}
