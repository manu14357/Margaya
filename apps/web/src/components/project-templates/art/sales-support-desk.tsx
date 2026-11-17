import { Tag } from "lucide-react";
import { ArtFrame, Badge, FlowArrow, Pill, Skeleton } from "./primitives";
import type { TemplateArtProps } from "./types";

/** A priced deal request flows from the form to the top of the desk's queue. */
export default function SalesSupportDeskArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={5} className={className}>
      <Skeleton.Rows h={170} highlight={1} n={5} w={168} x={20} y={44} />
      <Skeleton.Form fields={2} h={130} w={104} x={204} y={84} />
      <FlowArrow bend={-0.35} from={[214, 166]} to={[184, 118]} tone="accent" />
      <Pill solid w={62} x={34} y={35} />
      <Badge icon={Tag} sparks="top-right" x={256} y={60} />
    </ArtFrame>
  );
}
