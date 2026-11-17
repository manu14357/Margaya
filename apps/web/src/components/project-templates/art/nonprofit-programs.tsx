import { Sprout } from "lucide-react";
import { ArtFrame, Badge, Dot, FlowArrow, Skeleton, Tick } from "./primitives";
import type { TemplateArtProps } from "./types";

/** Program rows growing longer week by week, joined like a young plant. */
export default function NonprofitProgramsArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={1} className={className}>
      <Skeleton.Timeline
        bars={[
          [0, 0.22],
          [0, 0.42],
          [0, 0.64],
          [0, 0.86],
        ]}
        h={180}
        highlight={3}
        w={280}
        x={20}
        y={40}
      />
      <FlowArrow bend={0.25} from={[134, 80]} to={[214, 116]} />
      <Dot r={5} x={127} y={80} />
      <Dot r={7} x={169} y={102} />
      <Dot r={9} x={214} y={124} />
      <Tick x={274} y={146} />
      <Badge icon={Sprout} sparks="top-right" x={262} y={56} />
    </ArtFrame>
  );
}
