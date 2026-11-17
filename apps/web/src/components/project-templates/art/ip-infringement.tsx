import { ShieldCheck } from "lucide-react";
import {
  AccentBar,
  ArtFrame,
  Badge,
  Dot,
  Pill,
  Skeleton,
  Tick,
} from "./primitives";
import type { TemplateArtProps } from "./types";

/** A case file with the copied line marked, the lightest step of the response ladder taken, and a shield. */
export default function IpInfringementArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={3} className={className}>
      <Skeleton.Doc h={180} highlight={2} lines={5} w={176} x={112} y={34} />
      <Dot r={4.5} tone="accent-7" x={250} y={98} />
      <Pill solid w={50} x={214} y={25} />
      <AccentBar h={10} w={34} x={136} y={170} />
      <AccentBar h={10} tone="soft" w={34} x={174} y={154} />
      <AccentBar h={10} tone="soft" w={34} x={212} y={138} />
      <Tick r={11} x={153} y={150} />
      <Badge
        icon={ShieldCheck}
        size={52}
        sparks="left"
        sparkCount={4}
        x={108}
        y={70}
      />
    </ArtFrame>
  );
}
