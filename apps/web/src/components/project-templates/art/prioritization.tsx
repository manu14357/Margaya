import { ArrowDownWideNarrow } from "lucide-react";
import { ArtFrame, Badge, Dot, Skeleton } from "./primitives";
import type { TemplateArtProps } from "./types";

/** Candidates ranked by score, longest bar first, one with a shaky number. */
export default function PrioritizationArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={3} className={className}>
      <Skeleton.Chart
        h={200}
        highlight={0}
        horizontal
        values={[0.92, 0.74, 0.58, 0.44, 0.3]}
        w={236}
        x={24}
        y={34}
      />
      <Dot r={4.5} tone="accent-5" x={170} y={124} />
      <Badge
        icon={ArrowDownWideNarrow}
        sparks="top-right"
        sparkCount={4}
        x={262}
        y={66}
      />
    </ArtFrame>
  );
}
