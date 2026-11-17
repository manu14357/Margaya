import { Bug } from "lucide-react";
import { ArtFrame, Badge, Dot, Pill, Skeleton, Tick } from "./primitives";
import type { TemplateArtProps } from "./types";

/** A triaged bug list: one critical report up top, one fix verified. */
export default function BugTrackingArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={8} className={className}>
      <Skeleton.Rows h={170} highlight={1} n={5} w={236} x={64} y={40} />
      <Dot r={4.5} tone="accent-7" x={88} y={84} />
      <Pill tone="accent-7" w={54} x={214} y={31} />
      <Tick x={276} y={130} />
      <Badge icon={Bug} sparks="left" sparkCount={4} x={46} y={66} />
    </ArtFrame>
  );
}
