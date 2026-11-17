import { Leaf } from "lucide-react";
import { AccentBar, ArtFrame, Badge, Pill, Skeleton } from "./primitives";
import type { TemplateArtProps } from "./types";

/** An application page with its funded amount, beside a deadline calendar. */
export default function GrantTrackerArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={1} className={className}>
      <Skeleton.Doc h={180} highlight={2} lines={7} w={140} x={58} y={40} />
      <AccentBar h={12} w={64} x={76} y={168} />
      <Skeleton.Calendar
        days={3}
        h={104}
        highlight={[7]}
        w={92}
        weeks={3}
        x={212}
        y={70}
      />
      <Pill tone="accent-5" w={52} x={226} y={61} />
      <Badge icon={Leaf} sparks="top-left" x={60} y={52} />
    </ArtFrame>
  );
}
