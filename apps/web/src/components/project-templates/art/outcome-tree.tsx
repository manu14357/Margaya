import { Network } from "lucide-react";
import {
  AccentCard,
  ArtFrame,
  Badge,
  Dot,
  FlowArrow,
  Panel,
  Tick,
} from "./primitives";
import type { TemplateArtProps } from "./types";

/** One outcome branching into three needs: one chosen and proven, one dropped. */
export default function OutcomeTreeArt({ className }: TemplateArtProps) {
  const branch = { h: 28, lines: 1, w: 60 } as const;
  return (
    <ArtFrame accent={3} className={className}>
      <Panel h={190} w={256} x={20} y={30} />
      <AccentCard h={30} lines={1} w={80} x={108} y={44} />
      <FlowArrow bend={-0.15} from={[132, 82]} to={[68, 108]} />
      <FlowArrow bend={0} from={[148, 82]} to={[148, 108]} />
      <FlowArrow bend={0.15} dashed from={[164, 82]} to={[228, 108]} />
      <AccentCard {...branch} tone="soft" x={38} y={112} />
      <AccentCard {...branch} x={118} y={112} />
      <AccentCard {...branch} outline x={198} y={112} />
      <Dot r={5} tone="skeleton" x={56} y={164} />
      <Dot r={5} tone="skeleton" x={80} y={164} />
      <Dot r={5} x={136} y={164} />
      <Tick r={8} x={160} y={164} />
      <Badge icon={Network} sparks="top-right" x={274} y={168} />
    </ArtFrame>
  );
}
