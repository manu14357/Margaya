import { ListChecks } from "lucide-react";
import { ArtFrame, Avatar, Badge, Skeleton, Tick } from "./primitives";
import type { TemplateArtProps } from "./types";

/** A short shared task list: two items ticked off, one owned and in hand. */
export default function TaskTrackingArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={1} className={className}>
      <Skeleton.Rows h={180} highlight={2} n={5} w={220} x={78} y={36} />
      <Tick r={8} x={102} y={80} />
      <Tick r={8} x={102} y={104} />
      <Avatar r={9} tone="accent" x={266} y={128} />
      <Badge icon={ListChecks} sparks="top-left" x={62} y={58} />
    </ArtFrame>
  );
}
