import { Flag } from "lucide-react";
import { ArtFrame, Badge, FlowArrow, Skeleton } from "./primitives";
import type { TemplateArtProps } from "./types";

/** Team lanes on one timeline, with linked bars converging on a shared goal. */
export default function CrossTeamPlanningArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={8} className={className}>
      <Skeleton.Timeline
        bars={[
          [0, 0.34],
          [0.1, 0.42],
          [0.04, 0.3],
          [0.28, 0.4],
          [0.12, 0.34],
        ]}
        h={180}
        highlight={[1, 3]}
        w={232}
        x={20}
        y={30}
      />
      <FlowArrow bend={-0.3} from={[168, 96]} to={[236, 112]} tone="accent" />
      <FlowArrow bend={0.3} from={[193, 140]} to={[236, 124]} tone="accent" />
      <Badge icon={Flag} sparks="right" x={262} y={118} />
    </ArtFrame>
  );
}
