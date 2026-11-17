import { CircleQuestionMark } from "lucide-react";
import { ArtFrame, Badge, FlowArrow, Skeleton, Tick } from "./primitives";
import type { TemplateArtProps } from "./types";

/** A question travels to the one bar that answers it, checked and ticked. */
export default function AnalyticsRequestDeskArt({
  className,
}: TemplateArtProps) {
  return (
    <ArtFrame accent={6} className={className}>
      <Skeleton.Chart
        h={152}
        highlight={3}
        values={[0.42, 0.64, 0.5, 0.9, 0.58]}
        w={232}
        x={66}
        y={34}
      />
      <FlowArrow bend={0.35} from={[82, 44]} to={[205, 70]} tone="accent" />
      <Tick x={222} y={62} />
      <Badge icon={CircleQuestionMark} sparks="left" x={66} y={70} />
    </ArtFrame>
  );
}
