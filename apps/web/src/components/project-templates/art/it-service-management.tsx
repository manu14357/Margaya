import { Zap } from "lucide-react";
import { ArtFrame, Badge, Dot, FlowArrow, Skeleton } from "./primitives";
import type { TemplateArtProps } from "./types";

/** Four lanes on one board: an incident leads to a problem, then a change. */
export default function ItServiceManagementArt({
  className,
}: TemplateArtProps) {
  return (
    <ArtFrame accent={2} className={className}>
      <Skeleton.Board
        cards={[1, 1, 1, 2]}
        columns={4}
        h={170}
        highlight={[
          { column: 0, card: 0 },
          { column: 2, card: 0 },
        ]}
        w={264}
        x={20}
        y={44}
      />
      <Dot r={4.5} tone="accent-7" x={72} y={98} />
      <FlowArrow bend={-0.45} from={[58, 122]} to={[176, 122]} tone="accent" />
      <Badge icon={Zap} sparks="top-right" x={272} y={52} />
    </ArtFrame>
  );
}
