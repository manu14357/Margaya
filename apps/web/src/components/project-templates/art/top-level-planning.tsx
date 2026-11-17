import { Telescope } from "lucide-react";
import { AccentBar, ArtFrame, Badge, Dot, Pill, Skeleton } from "./primitives";
import type { TemplateArtProps } from "./types";

/** Three initiatives on one timeline, two milestones ahead and one bar running late. */
export default function TopLevelPlanningArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={8} className={className}>
      <Skeleton.Timeline
        bars={[
          [0, 0],
          [0, 0.5],
          [0.18, 0.62],
          [0.42, 0.4],
          [0.1, 0.3],
        ]}
        h={180}
        highlight={[1, 2, 3]}
        w={280}
        x={20}
        y={40}
      />
      <AccentBar h={12} tone="accent-5" w={22} x={225} y={118} />
      <Dot r={6} tone="ink" x={185} y={80} />
      <Dot r={6} tone="ink" x={251} y={80} />
      <Pill solid w={62} x={218} y={31} />
      <Badge icon={Telescope} sparks="top-left" x={48} y={50} />
    </ArtFrame>
  );
}
