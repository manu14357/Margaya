import { Image } from "lucide-react";
import { ArtFrame, Badge, FlowArrow, Skeleton, Tick } from "./primitives";
import type { TemplateArtProps } from "./types";

/** One request form feeding a grid of asset tiles, one delivered. */
export default function MarketingAssetsArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={4} className={className}>
      <Skeleton.Form fields={2} h={170} w={108} x={18} y={56} />
      <Skeleton.Cards
        cols={3}
        h={180}
        highlight={4}
        n={6}
        w={160}
        x={144}
        y={40}
      />
      <FlowArrow bend={-0.35} from={[96, 160]} to={[152, 128]} tone="accent" />
      <Tick x={244} y={124} />
      <Badge icon={Image} sparks="top-left" x={58} y={52} />
    </ArtFrame>
  );
}
