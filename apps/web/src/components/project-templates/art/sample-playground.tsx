import { Compass } from "lucide-react";
import {
  AccentCard,
  ArtFrame,
  Badge,
  Dot,
  FlowArrow,
  Panel,
  Pill,
  Tick,
} from "./primitives";
import type { TemplateArtProps } from "./types";

/** A dotted trail of tour stops, the first ticked, winding up to a flag. */
export default function SamplePlaygroundArt({ className }: TemplateArtProps) {
  const done = { dashed: true, tone: "accent" } as const;
  const next = { r: 7, tone: "strong" } as const;
  return (
    <ArtFrame accent={3} className={className}>
      <Panel h={180} w={276} x={22} y={40} />
      <FlowArrow {...done} bend={-0.25} from={[66, 164]} to={[104, 128]} />
      <FlowArrow bend={0.3} dashed from={[116, 126]} to={[152, 150]} />
      <FlowArrow bend={-0.3} dashed from={[166, 150]} to={[202, 116]} />
      <FlowArrow bend={0.25} dashed from={[214, 110]} to={[250, 88]} />
      <FlowArrow bend={-0.2} dashed from={[262, 80]} to={[268, 56]} />
      <AccentCard h={30} tilt={-4} tone="soft" w={78} x={122} y={66} />
      <Tick r={11} x={58} y={170} />
      <Dot r={8} x={110} y={122} />
      <Dot {...next} x={160} y={154} />
      <Dot {...next} x={208} y={112} />
      <Dot {...next} x={256} y={84} />
      <Pill solid w={56} x={232} y={31} />
      <Badge icon={Compass} sparks="top-left" x={66} y={70} />
    </ArtFrame>
  );
}
