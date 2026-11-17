import { Rocket } from "lucide-react";
import { AccentBar, AccentCard, ArtFrame, Badge, Panel } from "./primitives";
import type { TemplateArtProps } from "./types";

/** Now, next and later: solid, softer, then only outlined. */
export default function ProductRoadmapArt({ className }: TemplateArtProps) {
  const card = { h: 28, lines: 1, w: 74 } as const;
  return (
    <ArtFrame accent={3} className={className}>
      <Panel h={180} w={268} x={26} y={38} />
      <AccentBar h={6} tone="strong" w={40} x={40} y={52} />
      <AccentBar h={6} tone="strong" w={32} x={126} y={52} />
      <AccentBar h={6} tone="strong" w={36} x={212} y={52} />
      <AccentCard {...card} x={38} y={68} />
      <AccentCard {...card} x={38} y={104} />
      <AccentCard {...card} x={38} y={140} />
      <AccentBar h={6} w={74} x={38} y={180} />
      <AccentCard {...card} tone="soft" x={124} y={68} />
      <AccentCard {...card} tone="soft" x={124} y={104} />
      <AccentCard {...card} outline x={210} y={68} />
      <Badge icon={Rocket} sparks="top-right" x={250} y={150} />
    </ArtFrame>
  );
}
