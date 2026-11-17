import { Award } from "lucide-react";
import {
  AccentBar,
  AccentCard,
  ArtFrame,
  Badge,
  Panel,
  Tick,
} from "./primitives";
import type { TemplateArtProps } from "./types";

/** Three proposals side by side; the winner is raised and wears a ribbon. */
export default function RfpProcessArt({ className }: TemplateArtProps) {
  const doc = { h: 96, lines: 3, w: 68 } as const;
  return (
    <ArtFrame accent={1} className={className}>
      <Panel h={180} w={272} x={24} y={40} />
      <AccentCard {...doc} tone="skeleton" x={48} y={96} />
      <AccentCard {...doc} tone="skeleton" x={204} y={96} />
      <AccentBar h={24} r={3} w={8} x={149} y={168} />
      <AccentBar h={24} r={3} w={8} x={163} y={168} />
      <AccentCard {...doc} x={126} y={70} />
      <Tick r={12} tone="ink" x={160} y={166} />
      <Badge icon={Award} sparks="top-left" x={46} y={52} />
    </ArtFrame>
  );
}
