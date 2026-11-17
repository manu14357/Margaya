import { RefreshCw } from "lucide-react";
import { ArtFrame, Badge, FlowArrow, Skeleton, Tick } from "./primitives";
import type { TemplateArtProps } from "./types";

/** A working-week close calendar with its close days done and signed off, looping into next month. */
export default function FinancialCloseArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={1} className={className}>
      <Skeleton.Calendar
        days={5}
        events={[7, 13]}
        h={180}
        highlight={[0, 1, 2, 3]}
        w={208}
        x={66}
        y={36}
      />
      <Tick r={10} x={245} y={89} />
      <FlowArrow bend={-0.25} from={[288, 180]} to={[288, 64]} tone="accent" />
      <Badge icon={RefreshCw} sparks="left" x={66} y={120} />
    </ArtFrame>
  );
}
