import { Layers } from "lucide-react";
import { AccentBar, ArtFrame, Badge, Dot, Skeleton } from "./primitives";
import type { TemplateArtProps } from "./types";

/** Initiatives stacked on one timeline: one funded bar in focus, one late, one at risk. */
export default function PortfolioRoadmapArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={3} className={className}>
      <Skeleton.Timeline
        bars={[
          [0, 0.42],
          [0.22, 0.45],
          [0.46, 0.34],
          [0.1, 0.5],
          [0.5, 0.35],
        ]}
        h={180}
        highlight={1}
        today={0.8}
        w={250}
        x={20}
        y={36}
      />
      <AccentBar tone="soft" h={12} w={73.9} x={82} y={70} />
      <AccentBar tone="accent-5" h={12} w={20} x={180} y={92} />
      <AccentBar tone="soft" h={12} w={88} x={99.6} y={136} />
      <Dot r={5} tone="accent-7" x={198} y={142} />
      <Badge icon={Layers} sparks="right" x={266} y={120} />
    </ArtFrame>
  );
}
