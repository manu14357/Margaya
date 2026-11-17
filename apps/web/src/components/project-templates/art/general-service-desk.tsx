import { Inbox } from "lucide-react";
import { ArtFrame, Badge, FlowArrow, Skeleton } from "./primitives";
import type { TemplateArtProps } from "./types";

/** One front door: every request flows in and is sorted into three lanes. */
export default function GeneralServiceDeskArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={2} className={className}>
      <Skeleton.Board
        cards={[2, 3, 1]}
        columns={3}
        h={140}
        highlight={{ column: 1, card: 0 }}
        w={280}
        x={20}
        y={86}
      />
      <FlowArrow bend={-0.2} from={[56, 80]} to={[74, 112]} />
      <FlowArrow bend={0.2} from={[78, 62]} to={[160, 110]} tone="accent" />
      <FlowArrow bend={0.25} from={[80, 46]} to={[248, 110]} />
      <Badge icon={Inbox} sparks="top-left" x={56} y={56} />
    </ArtFrame>
  );
}
