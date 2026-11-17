import { Scale } from "lucide-react";
import {
  AccentBar,
  ArtFrame,
  Badge,
  FlowArrow,
  Skeleton,
  Tick,
} from "./primitives";
import type { TemplateArtProps } from "./types";

/** A request form becomes a contract page, marked up and signed. */
export default function LegalRequestDeskArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={3} className={className}>
      <Skeleton.Form button="strong" fields={2} h={118} w={104} x={20} y={70} />
      <Skeleton.Doc h={190} highlight={2} lines={7} w={146} x={146} y={30} />
      <AccentBar w={56} x={164} y={170} />
      <Tick x={236} y={175} />
      <FlowArrow bend={0.3} from={[94, 64]} to={[150, 82]} tone="accent" />
      <Badge icon={Scale} sparks="top-left" x={54} y={50} />
    </ArtFrame>
  );
}
