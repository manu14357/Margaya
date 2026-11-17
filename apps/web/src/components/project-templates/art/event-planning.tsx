import { Ticket } from "lucide-react";
import { AccentCard, ArtFrame, Badge, Pill, Skeleton } from "./primitives";
import type { TemplateArtProps } from "./types";

/** A month counting down to one lifted event day, marked with a flag. */
export default function EventPlanningArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={5} className={className}>
      <Skeleton.Calendar
        days={7}
        events={[2, 8, 10, 15]}
        h={176}
        w={256}
        x={22}
        y={40}
      />
      <AccentCard h={44} lines={1} tilt={-6} w={46} x={168} y={134} />
      <Pill solid w={40} x={180} y={120} />
      <Badge icon={Ticket} sparks="right" x={270} y={96} />
    </ArtFrame>
  );
}
