import { Timer } from "lucide-react";
import { AccentBar, ArtFrame, Badge, FlowArrow, Skeleton } from "./primitives";
import type { TemplateArtProps } from "./types";

/** A sprint board above two sprint bars, with unfinished work rolling over. */
export default function ScrumArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={8} className={className}>
      <Skeleton.Board
        cards={[2, 2, 1]}
        columns={3}
        h={118}
        highlight={{ column: 1, card: 0 }}
        w={236}
        x={20}
        y={30}
      />
      <AccentBar h={10} w={140} x={20} y={176} />
      <AccentBar h={10} tone="soft" w={116} x={168} y={176} />
      <FlowArrow bend={0.6} from={[136, 172]} to={[194, 172]} tone="accent" />
      <Badge icon={Timer} sparks="top-right" x={262} y={66} />
    </ArtFrame>
  );
}
