import { FileCheck } from "lucide-react";
import { AccentBar, ArtFrame, Badge, Pill, Skeleton, Tick } from "./primitives";
import type { TemplateArtProps } from "./types";

/** A newer version laid over the last one: one line marked, then signed off. */
export default function DocumentReviewArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame accent={3} className={className}>
      <Skeleton.Doc h={190} lines={8} w={150} x={142} y={24} />
      <Skeleton.Doc h={170} highlight={2} lines={5} w={156} x={92} y={48} />
      <Pill solid w={50} x={178} y={39} />
      <AccentBar h={6} tone="strong" w={64} x={110} y={180} />
      <Tick r={11} x={216} y={180} />
      <Badge icon={FileCheck} sparks="left" sparkCount={4} x={90} y={76} />
    </ArtFrame>
  );
}
