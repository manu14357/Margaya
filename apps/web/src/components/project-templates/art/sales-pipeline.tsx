import { TrendingUp } from "lucide-react";
import {
  AccentCard,
  ArtFrame,
  Badge,
  FlowArrow,
  Skeleton,
  Tick,
} from "./primitives";
import type { TemplateArtProps } from "./types";

/** Stages thin out like a funnel, and one deal is dragged into the win. */
export default function SalesPipelineArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={5} className={className}>
      <Skeleton.Board
        cards={[4, 3, 2, 0]}
        columns={4}
        h={180}
        w={280}
        x={20}
        y={40}
      />
      <FlowArrow bend={-0.25} from={[104, 26]} to={[236, 30]} />
      <AccentCard h={30} tilt={-6} w={68} x={226} y={94} />
      <Tick x={288} y={94} />
      <Badge icon={TrendingUp} sparks="top-left" x={50} y={44} />
    </ArtFrame>
  );
}
