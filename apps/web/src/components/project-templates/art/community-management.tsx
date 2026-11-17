import { Users } from "lucide-react";
import { ArtFrame, Avatar, Badge, Dot, Panel, Pill } from "./primitives";
import type { TemplateArtProps } from "./types";

/** A ring of members of different sizes around the community team. */
export default function CommunityManagementArt({
  className,
}: TemplateArtProps) {
  return (
    <ArtFrame accent={1} className={className}>
      <Panel h={180} w={264} x={28} y={40} />
      <Pill x={44} y={31} />
      <Avatar r={16} tone="strong" x={160} y={66} />
      <Avatar r={12} tone="strong" x={222} y={108} />
      <Avatar r={18} tone="soft" x={200} y={174} />
      <Avatar r={11} tone="strong" x={118} y={178} />
      <Avatar r={14} tone="strong" x={96} y={110} />
      <Dot r={6} tone="accent-7" x={234} y={96} />
      <Avatar r={32} tone="accent" x={160} y={128} />
      <Badge icon={Users} sparks="top-right" x={270} y={58} />
    </ArtFrame>
  );
}
