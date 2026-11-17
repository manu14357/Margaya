import { Plus } from "lucide-react";
import { AccentCard, ArtFrame, Badge, Skeleton } from "./primitives";
import type { TemplateArtProps } from "./types";

/** An empty board waiting for its first task. */
export default function BlankArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={1} className={className}>
      <Skeleton.Board cards={[0, 0, 0]} h={180} w={252} x={34} y={34} />
      <AccentCard h={26} lines={1} outline w={66} x={51} y={82} />
      <Badge icon={Plus} size={56} sparks="top-right" x={196} y={124} />
    </ArtFrame>
  );
}
