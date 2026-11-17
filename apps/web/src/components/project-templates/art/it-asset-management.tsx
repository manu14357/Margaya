import { Laptop } from "lucide-react";
import { ArtFrame, Badge, Dot, FlowArrow, Skeleton } from "./primitives";
import type { TemplateArtProps } from "./types";

/** Asset tiles: one handed out, one due for renewal, all on a loop. */
export default function ItAssetManagementArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={2} className={className}>
      <Skeleton.Cards h={170} highlight={1} w={262} x={40} y={46} />
      <Dot r={6} tone="accent-5" x={278} y={74} />
      <FlowArrow bend={0.45} from={[266, 182]} to={[186, 124]} tone="accent" />
      <Badge icon={Laptop} sparks="top-left" x={46} y={52} />
    </ArtFrame>
  );
}
