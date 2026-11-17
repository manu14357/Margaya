import { type LazyExoticComponent, lazy, Suspense } from "react";
import { ArtFrame, Skeleton } from "./art/primitives";
import { loadTemplateArt } from "./art/registry";
import type { TemplateArtComponent, TemplateArtProps } from "./art/types";

const lazyArts = new Map<string, LazyExoticComponent<TemplateArtComponent>>();

/** One stable lazy component per id, so React keeps its loaded state. */
function lazyArt(id: string) {
  const cached = lazyArts.get(id);
  if (cached) return cached;
  const loading = loadTemplateArt(id);
  if (!loading) return null;
  const component = lazy(() => loading);
  lazyArts.set(id, component);
  return component;
}

/** Starts loading arts ahead of time, e.g. when the gallery opens. */
export function preloadTemplateArt(ids: readonly string[]) {
  for (const id of ids) lazyArt(id);
}

/** A neutral board, shown while an illustration loads or when it has none. */
export function FallbackTemplateArt({ className }: TemplateArtProps) {
  return (
    <ArtFrame className={className}>
      <Skeleton.Board
        cards={[2, 1, 1]}
        columns={3}
        h={180}
        w={248}
        x={36}
        y={30}
      />
    </ArtFrame>
  );
}

/** The gallery illustration for a template id. Decorative: the card has the text. */
export function TemplateArt({
  id,
  className,
}: TemplateArtProps & { id: string | null | undefined }) {
  const Art = id ? lazyArt(id) : null;
  if (!Art) return <FallbackTemplateArt className={className} />;
  return (
    <Suspense fallback={<FallbackTemplateArt className={className} />}>
      <Art className={className} />
    </Suspense>
  );
}
