import { Mail } from "lucide-react";
import { ArtFrame, Badge, FlowArrow, Skeleton, Tick } from "./primitives";
import type { TemplateArtProps } from "./types";

/** Sends climbing as rising bars, three QA ticks beside the latest email. */
export default function EmailCampaignArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={5} className={className}>
      <Skeleton.Chart
        h={176}
        highlight={3}
        values={[0.34, 0.5, 0.64, 0.86]}
        w={220}
        x={22}
        y={40}
      />
      <FlowArrow bend={-0.2} from={[56, 150]} to={[196, 92]} />
      <Tick x={274} y={112} />
      <Tick x={274} y={140} />
      <Tick x={274} y={168} />
      <Badge icon={Mail} sparks="top-right" x={250} y={52} />
    </ArtFrame>
  );
}
