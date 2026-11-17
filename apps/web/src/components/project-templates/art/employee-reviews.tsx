import { MessagesSquare } from "lucide-react";
import { AccentBar, AccentCard, ArtFrame, Badge, Skeleton } from "./primitives";
import type { TemplateArtProps } from "./types";

/** The review guide beside a two-way conversation and the cycle's progress. */
export default function EmployeeReviewsArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={4} className={className}>
      <Skeleton.Doc h={170} highlight={2} lines={6} w={150} x={20} y={48} />
      <AccentCard h={34} lines={2} tilt={4} tone="soft" w={98} x={186} y={70} />
      <AccentCard h={34} lines={2} tilt={-4} w={98} x={204} y={114} />
      <AccentBar h={10} tone="skeleton" w={112} x={190} y={170} />
      <AccentBar h={10} w={74} x={190} y={170} />
      <Badge icon={MessagesSquare} sparks="top-right" x={168} y={52} />
    </ArtFrame>
  );
}
