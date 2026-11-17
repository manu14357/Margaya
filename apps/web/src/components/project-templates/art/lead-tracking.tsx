import { UserPlus } from "lucide-react";
import {
  AccentCard,
  ArtFrame,
  Badge,
  Dot,
  FlowArrow,
  Skeleton,
} from "./primitives";
import type { TemplateArtProps } from "./types";

/** New leads rising out of the list, the hottest one lifted and marked. */
export default function LeadTrackingArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={5} className={className}>
      <Skeleton.Rows h={150} highlight={0} n={4} w={236} x={50} y={92} />
      <FlowArrow bend={0.4} from={[150, 124]} to={[164, 72]} tone="accent" />
      <AccentCard avatar h={44} tilt={-5} w={112} x={168} y={30} />
      <Dot r={5} tone="accent-7" x={276} y={34} />
      <Badge icon={UserPlus} sparks="top-left" x={52} y={92} />
    </ArtFrame>
  );
}
