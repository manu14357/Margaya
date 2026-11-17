import { StickyNote } from "lucide-react";
import { AccentCard, ArtFrame, Badge, Skeleton, Tick } from "./primitives";
import type { TemplateArtProps } from "./types";

/** A short personal list with one sticky note on top, its first line ticked. */
export default function PersonalPlannerArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={1} className={className}>
      <Skeleton.Rows h={170} header={false} n={5} w={180} x={30} y={46} />
      <AccentCard h={66} lines={3} tilt={-6} w={118} x={164} y={96} />
      <Tick x={166} y={110} />
      <Badge icon={StickyNote} sparks="top-right" x={210} y={52} />
    </ArtFrame>
  );
}
