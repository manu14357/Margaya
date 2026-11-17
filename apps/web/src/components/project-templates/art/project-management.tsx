import { ClipboardList } from "lucide-react";
import { AccentBar, ArtFrame, Badge, Dot, Skeleton } from "./primitives";
import type { TemplateArtProps } from "./types";

/** Four phases stepping across a timeline, two milestones and one risk on delivery. */
export default function ProjectManagementArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={1} className={className}>
      <Skeleton.Timeline
        bars={[
          [0, 0.24],
          [0.2, 0.32],
          [0.46, 0.3],
          [0.72, 0.22],
        ]}
        h={170}
        highlight={1}
        today={0.36}
        w={280}
        x={20}
        y={56}
      />
      <AccentBar h={12} tone="soft" w={49} x={82} y={90} />
      <Dot r={6} tone="ink" x={188} y={118} />
      <Dot r={6} tone="ink" x={276} y={162} />
      <Dot r={5} tone="accent-5" x={222} y={140} />
      <Badge icon={ClipboardList} sparks="top-right" x={262} y={56} />
    </ArtFrame>
  );
}
