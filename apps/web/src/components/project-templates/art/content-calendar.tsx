import { PenLine } from "lucide-react";
import { ArtFrame, Badge, Skeleton, Tick } from "./primitives";
import type { TemplateArtProps } from "./types";

/** A month of publish days on a steady rhythm, the first one already live. */
export default function ContentCalendarArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={5} className={className}>
      <Skeleton.Calendar
        days={7}
        events={[5, 13, 22]}
        h={176}
        highlight={[1, 10, 15, 24]}
        w={256}
        x={22}
        y={40}
      />
      <Tick x={96} y={80} />
      <Badge icon={PenLine} sparks="top-right" x={272} y={54} />
    </ArtFrame>
  );
}
