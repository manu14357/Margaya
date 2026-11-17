import { DoorOpen } from "lucide-react";
import {
  AccentCard,
  ArtFrame,
  Avatar,
  Badge,
  FlowArrow,
  Skeleton,
} from "./primitives";
import type { TemplateArtProps } from "./types";

/** A welcome card for a new starter joining the private HR queue. */
export default function HrServiceDeskArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={4} className={className}>
      <Skeleton.Rows
        h={164}
        header={false}
        highlight={0}
        n={5}
        w={168}
        x={20}
        y={56}
      />
      <AccentCard avatar h={50} tilt={6} w={88} x={212} y={82} />
      <FlowArrow bend={0.35} from={[214, 120]} to={[194, 84]} tone="accent" />
      <Avatar r={15} tone="accent" x={236} y={168} />
      <Avatar r={12} tone="accent" x={270} y={174} />
      <Badge icon={DoorOpen} sparks="top-right" x={132} y={46} />
    </ArtFrame>
  );
}
