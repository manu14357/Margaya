import { Activity } from "lucide-react";
import { AccentBar, ArtFrame, Badge, Pill, Skeleton } from "./primitives";
import type { TemplateArtProps } from "./types";

/** A timeline of alerts and changes, with one live incident spiking now. */
export default function ItOperationsArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={2} className={className}>
      <Skeleton.Timeline
        bars={[
          [0, 0.4],
          [0.3, 0.3],
          [0.05, 0.5],
          [0.55, 0.35],
          [0.15, 0.4],
        ]}
        h={180}
        highlight={1}
        w={272}
        x={24}
        y={40}
      />
      <AccentBar h={12} tone="accent-7" w={69} x={195} y={140} />
      <AccentBar h={36} r={3} tone="accent-7" w={6} x={226} y={116} />
      <Pill solid w={60} x={218} y={31} />
      <Badge icon={Activity} sparks="top-left" x={60} y={50} />
    </ArtFrame>
  );
}
