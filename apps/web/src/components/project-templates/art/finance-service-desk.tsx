import { Receipt } from "lucide-react";
import { ArtFrame, Badge, FlowArrow, Skeleton, Tick } from "./primitives";
import type { TemplateArtProps } from "./types";

/** A money request flows from the form into the queue and gets approved. */
export default function FinanceServiceDeskArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={1} className={className}>
      <Skeleton.Rows h={170} highlight={1} n={5} w={176} x={20} y={44} />
      <Skeleton.Form fields={2} h={136} w={98} x={210} y={74} />
      <FlowArrow bend={0.35} from={[230, 176]} to={[184, 124]} tone="accent" />
      <Tick r={10} x={168} y={112} />
      <Badge icon={Receipt} sparks="top-right" x={258} y={70} />
    </ArtFrame>
  );
}
