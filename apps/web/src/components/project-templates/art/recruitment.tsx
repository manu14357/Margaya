import { UserSearch } from "lucide-react";
import { AccentCard, ArtFrame, Badge, Skeleton, Tick } from "./primitives";
import type { TemplateArtProps } from "./types";

/** A hiring funnel: stages hold fewer candidates until one card is hired. */
export default function RecruitmentArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={4} className={className}>
      <Skeleton.Board
        cards={[4, 3, 2, 0]}
        columns={4}
        h={170}
        w={280}
        x={20}
        y={52}
      />
      <AccentCard avatar h={36} lines={1} tilt={-5} w={62} x={226} y={106} />
      <Tick x={284} y={108} />
      <Badge icon={UserSearch} sparks="top-left" x={56} y={54} />
    </ArtFrame>
  );
}
