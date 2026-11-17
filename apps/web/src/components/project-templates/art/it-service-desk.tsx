import { Headset } from "lucide-react";
import { ArtFrame, Badge, FlowArrow, Pill, Skeleton } from "./primitives";
import type { TemplateArtProps } from "./types";

/** A request form feeding the IT queue, with someone on call. */
export default function ItServiceDeskArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={2} className={className}>
      <Skeleton.Form fields={2} h={128} w={120} x={22} y={52} />
      <Skeleton.Rows
        h={170}
        header={false}
        highlight={0}
        n={5}
        w={150}
        x={160}
        y={60}
      />
      <FlowArrow bend={-0.3} from={[100, 158]} to={[162, 92]} tone="accent" />
      <Badge icon={Headset} sparks="top-left" x={60} y={44} />
      <Pill solid w={62} x={234} y={51} />
    </ArtFrame>
  );
}
