import { Package } from "lucide-react";
import {
  AccentCard,
  ArtFrame,
  Badge,
  Dot,
  FlowArrow,
  Skeleton,
  Tick,
} from "./primitives";
import type { TemplateArtProps } from "./types";

/** A purchase queue beside the chain it follows: parcel, matched paperwork, payment. */
export default function ProcurementArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={6} className={className}>
      <Skeleton.Rows h={170} highlight={1} n={5} w={200} x={20} y={48} />
      <FlowArrow bend={-0.25} from={[262, 84]} to={[264, 104]} />
      <AccentCard h={38} tilt={-4} w={56} x={240} y={108} />
      <Tick x={292} y={110} />
      <FlowArrow bend={0.3} from={[266, 150]} to={[268, 170]} />
      <Dot r={9} tone="ink" x={268} y={180} />
      <Dot r={4} tone="surface" x={268} y={180} />
      <Badge icon={Package} sparks="top-left" x={268} y={60} />
    </ArtFrame>
  );
}
