import { Wallet } from "lucide-react";
import { ArtFrame, Badge, Skeleton, Tick } from "./primitives";
import type { TemplateArtProps } from "./types";

/** Four department budgets as bars, the tallest one approved with a tick. */
export default function BudgetPlanningArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={1} className={className}>
      <Skeleton.Chart
        h={200}
        highlight={2}
        values={[0.46, 0.64, 0.84, 0.55]}
        w={224}
        x={22}
        y={36}
      />
      <Tick r={10} x={158} y={70} />
      <Badge icon={Wallet} sparks="top-right" x={250} y={74} />
    </ArtFrame>
  );
}
