import { ScrollText } from "lucide-react";
import {
  AccentBar,
  ArtFrame,
  Badge,
  FlowArrow,
  Skeleton,
  Tick,
} from "./primitives";
import type { TemplateArtProps } from "./types";

/** A policy page with an approval seal and a yearly review loop. */
export default function PolicyManagementArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={4} className={className}>
      <Skeleton.Doc h={190} highlight={1} lines={7} w={160} x={80} y={34} />
      <AccentBar w={60} x={98} y={168} />
      <Tick r={15} x={238} y={168} />
      <FlowArrow bend={-0.6} from={[262, 146]} to={[256, 62]} tone="accent" />
      <Badge icon={ScrollText} sparks="top-left" x={78} y={56} />
    </ArtFrame>
  );
}
