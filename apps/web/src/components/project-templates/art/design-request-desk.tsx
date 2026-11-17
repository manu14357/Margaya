import { Palette } from "lucide-react";
import {
  AccentBar,
  AccentCard,
  ArtFrame,
  Badge,
  FlowArrow,
  Skeleton,
} from "./primitives";
import type { TemplateArtProps } from "./types";

/** A design request becomes a lifted artwork frame with its swatch strip. */
export default function DesignRequestDeskArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={4} className={className}>
      <Skeleton.Form fields={3} h={180} w={136} x={22} y={40} />
      <FlowArrow bend={0.35} from={[146, 150]} to={[194, 128]} tone="accent" />
      <AccentCard h={78} lines={0} tilt={-6} w={96} x={194} y={62} />
      <AccentBar h={14} r={5} w={28} x={196} y={156} />
      <AccentBar h={14} r={5} tone="soft" w={28} x={230} y={156} />
      <AccentBar h={14} r={5} tone="strong" w={28} x={264} y={156} />
      <Badge icon={Palette} sparks="top-right" x={268} y={56} />
    </ArtFrame>
  );
}
