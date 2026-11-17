import { MessageCircle } from "lucide-react";
import {
  AccentCard,
  ArtFrame,
  Badge,
  FlowArrow,
  Skeleton,
  Tick,
} from "./primitives";
import type { TemplateArtProps } from "./types";

/** One customer message splitting three ways: answered, fixed or kept as an idea. */
export default function CustomerSupportArt({ className }: TemplateArtProps) {
  const card = { h: 30, w: 82, x: 222 } as const;
  return (
    <ArtFrame accent={6} className={className}>
      <Skeleton.Rows h={170} highlight={1} n={4} w={150} x={16} y={58} />
      <FlowArrow bend={0.25} from={[170, 124]} to={[218, 66]} />
      <FlowArrow bend={0} from={[170, 124]} to={[218, 112]} tone="accent" />
      <FlowArrow bend={-0.25} from={[170, 124]} to={[218, 158]} />
      <AccentCard {...card} lines={1} tone="soft" y={50} />
      <AccentCard {...card} y={96} />
      <AccentCard {...card} lines={1} outline y={142} />
      <Tick x={298} y={52} />
      <Badge icon={MessageCircle} sparks="top-left" x={46} y={56} />
    </ArtFrame>
  );
}
