import { MousePointer2 } from "lucide-react";
import {
  AccentBar,
  AccentCard,
  ArtFrame,
  Badge,
  FlowArrow,
  Panel,
  Tick,
} from "./primitives";
import type { TemplateArtProps } from "./types";

/** Two diamonds, research then design, widening and narrowing to a handoff. */
export default function UxDesignArt({ className }: TemplateArtProps) {
  const diamond = { h: 52, lines: 0, tilt: 45, w: 52 } as const;
  return (
    <ArtFrame accent={4} className={className}>
      <Panel h={180} w={276} x={22} y={40} />
      <AccentBar h={6} tone="strong" w={56} x={40} y={56} />
      <AccentBar h={6} tone="skeleton" w={36} x={102} y={56} />
      <AccentCard {...diamond} tone="soft" x={50} y={94} />
      <AccentCard {...diamond} x={132} y={94} />
      <FlowArrow bend={-0.3} from={[204, 124]} to={[244, 124]} tone="accent" />
      <Tick r={11} x={262} y={124} />
      <AccentBar h={6} tone="skeleton" w={208} x={44} y={182} />
      <Badge icon={MousePointer2} sparks="top-right" x={264} y={50} />
    </ArtFrame>
  );
}
