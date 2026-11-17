import { Wrench } from "lucide-react";
import { AccentCard, ArtFrame, Badge, Dot, Skeleton, Tick } from "./primitives";
import type { TemplateArtProps } from "./types";

/** A building job queue: one job picked up, a hazard flagged, a fix done. */
export default function FacilitiesServiceDeskArt({
  className,
}: TemplateArtProps) {
  return (
    <ArtFrame accent={6} className={className}>
      <Skeleton.Rows h={180} highlight={1} n={5} w={256} x={46} y={38} />
      <Dot r={5} tone="accent-7" x={69} y={81} />
      <AccentCard avatar h={34} tilt={-5} w={98} x={172} y={92} />
      <Tick x={282} y={154} />
      <Badge icon={Wrench} sparks="top-left" x={50} y={50} />
    </ArtFrame>
  );
}
