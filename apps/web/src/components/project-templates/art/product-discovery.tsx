import { Lightbulb } from "lucide-react";
import { AccentCard, ArtFrame, Badge, Dot, Skeleton, Tick } from "./primitives";
import type { TemplateArtProps } from "./types";

/** Many ideas narrowing, through a few tested steps, into one proven card. */
export default function ProductDiscoveryArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={3} className={className}>
      <Skeleton.Cards cols={3} h={170} n={6} w={176} x={34} y={50} />
      <Dot r={7} tone="soft" x={224} y={172} />
      <Dot r={6} tone="soft" x={242} y={156} />
      <Dot r={5} x={252} y={138} />
      <AccentCard h={40} tilt={-5} w={74} x={226} y={80} />
      <Tick x={296} y={82} />
      <Badge icon={Lightbulb} sparks="top-left" x={52} y={54} />
    </ArtFrame>
  );
}
