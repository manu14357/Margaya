import { Inbox } from "lucide-react";
import { AccentCard, ArtFrame, Badge, FlowArrow, Skeleton } from "./primitives";
import type { TemplateArtProps } from "./types";

/** Requests from many teams converging through one door into a single queue. */
export default function DevelopmentRequestsArt({
  className,
}: TemplateArtProps) {
  return (
    <ArtFrame accent={8} className={className}>
      <Skeleton.Rows
        h={160}
        header={false}
        highlight={1}
        n={5}
        w={140}
        x={162}
        y={62}
      />
      <AccentCard h={28} lines={1} outline tilt={-6} w={54} x={20} y={46} />
      <AccentCard h={28} lines={1} tilt={4} w={54} x={30} y={100} />
      <AccentCard h={28} lines={1} outline tilt={-3} w={54} x={20} y={152} />
      <FlowArrow bend={-0.25} from={[78, 62]} to={[156, 116]} />
      <FlowArrow bend={0} from={[90, 116]} to={[156, 120]} tone="accent" />
      <FlowArrow bend={0.25} from={[78, 166]} to={[156, 124]} />
      <Badge icon={Inbox} sparks="top-left" x={162} y={56} />
    </ArtFrame>
  );
}
