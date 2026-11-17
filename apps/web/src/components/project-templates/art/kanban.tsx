import { ChevronsRight } from "lucide-react";
import { AccentCard, ArtFrame, Badge, FlowArrow, Skeleton } from "./primitives";
import type { TemplateArtProps } from "./types";

/** Work flowing across a board, with one urgent card jumping the queue. */
export default function KanbanArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={8} className={className}>
      <Skeleton.Board
        cards={[3, 2, 2, 1]}
        columns={4}
        h={150}
        highlight={{ column: 2, card: 0 }}
        w={280}
        x={20}
        y={18}
      />
      <AccentCard h={30} tilt={-6} tone="accent-7" w={74} x={84} y={92} />
      <FlowArrow bend={0.05} from={[40, 186]} to={[226, 186]} />
      <Badge icon={ChevronsRight} sparks="top-right" x={268} y={168} />
    </ArtFrame>
  );
}
