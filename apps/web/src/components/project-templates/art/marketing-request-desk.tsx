import { Megaphone } from "lucide-react";
import { AccentCard, ArtFrame, Badge, FlowArrow, Skeleton } from "./primitives";
import type { TemplateArtProps } from "./types";

/** Requests called out from the desk land on planned publishing days. */
export default function MarketingRequestDeskArt({
  className,
}: TemplateArtProps) {
  return (
    <ArtFrame accent={5} className={className}>
      <Skeleton.Calendar
        days={7}
        events={[3, 15, 22, 26]}
        h={176}
        highlight={[9, 17]}
        w={276}
        x={22}
        y={44}
      />
      <FlowArrow bend={-0.35} from={[90, 54]} to={[204, 98]} tone="accent" />
      <AccentCard h={28} lines={1} tilt={-6} w={64} x={206} y={98} />
      <Badge icon={Megaphone} sparks="top-left" x={62} y={50} />
    </ArtFrame>
  );
}
