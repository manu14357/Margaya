import { Rocket } from "lucide-react";
import { AccentBar, ArtFrame, Badge, Dot, Pill, Skeleton } from "./primitives";
import type { TemplateArtProps } from "./types";

/** A launch runway: before, on and after milestones, with launch day flagged. */
export default function GoToMarketArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={5} className={className}>
      <Skeleton.Timeline
        bars={[
          [0, 0.34],
          [0.14, 0.4],
          [0.36, 0.22],
          [0.64, 0.3],
        ]}
        h={180}
        today={0.5}
        w={280}
        x={20}
        y={40}
      />
      <AccentBar h={10} w={206} x={82} y={167} />
      <Dot r={7} tone="ink" x={113} y={172} />
      <Dot r={9} tone="accent-7" x={185} y={172} />
      <Dot r={7} tone="ink" x={257} y={172} />
      <Pill solid tone="accent-7" w={40} x={165} y={140} />
      <Badge icon={Rocket} sparks="top-right" x={268} y={52} />
    </ArtFrame>
  );
}
