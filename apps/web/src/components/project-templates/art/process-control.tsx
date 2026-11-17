import { Repeat } from "lucide-react";
import { ArtFrame, Badge, FlowArrow, Skeleton, Tick } from "./primitives";
import type { TemplateArtProps } from "./types";

/** Plan, do, check and act columns, with a loop back to the start and a checked result. */
export default function ProcessControlArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={6} className={className}>
      <Skeleton.Board
        cards={[2, 1, 1, 2]}
        columns={4}
        h={160}
        highlight={{ column: 2, card: 0 }}
        w={236}
        x={20}
        y={56}
      />
      <FlowArrow bend={-0.17} from={[222, 50]} to={[54, 50]} tone="accent" />
      <Tick x={184} y={106} />
      <Badge icon={Repeat} sparks="bottom-right" x={262} y={120} />
    </ArtFrame>
  );
}
