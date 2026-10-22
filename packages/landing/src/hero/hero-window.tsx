"use client";

import { useMemo } from "react";
import { useLandingCopy } from "../copy";
import { DemoStage } from "../demo";
import { cn } from "../lib/cn";
import { createHeroScene } from "../scenes/hero/hero-scene";

/** The hero scene's design sizes; the placeholder reserves the same box. */
export const HERO_STAGE = {
  size: { width: 1280, height: 800 },
  compactSize: { width: 640, height: 820 },
  compactBelow: 640,
} as const;

/*
 * The frame below draws the border, so the stage's own frame goes flat, and
 * its caption stays for screen readers only (the hero has no room for it).
 */
const STAGE_IN_FRAME =
  "[&>div]:rounded-none [&>div]:border-0 [&>div]:shadow-none [&>figcaption]:sr-only";

/** A cheap stand-in with the stage's exact box while the replica mounts. */
function StagePlaceholder() {
  return (
    <div
      aria-hidden
      className="flex aspect-[640/820] w-full bg-background @min-[640px]:aspect-[1280/800]"
    >
      <span className="hidden w-[5%] border-border/70 border-e bg-sidebar @min-[640px]:block" />
      <span className="hidden w-[19.4%] border-border/70 border-e bg-card @min-[640px]:block" />
      <span className="flex flex-1 flex-col">
        <span className="h-[6%] border-border/70 border-b" />
        <span className="flex flex-1 gap-[1%] p-[1%]">
          <span className="w-[30%] rounded-lg bg-muted/50 dark:bg-card/60" />
          <span className="w-[30%] rounded-lg bg-muted/50 dark:bg-card/60" />
          <span className="hidden w-[30%] rounded-lg bg-muted/50 @min-[640px]:block dark:bg-card/60" />
        </span>
      </span>
    </div>
  );
}

/**
 * The hero's product screen: the scripted capture-to-sheet demo in a flat
 * frame. `ready` mounts the replica; until then a placeholder keeps the
 * space.
 */
export function HeroWindow({
  ready,
  className,
}: {
  ready: boolean;
  className?: string;
}) {
  const copy = useLandingCopy();
  const scene = useMemo(() => createHeroScene(copy.demo), [copy.demo]);

  return (
    <div
      data-hero-window=""
      className={cn(
        "@container overflow-hidden rounded-xl border border-border bg-background shadow-xs",
        className,
      )}
    >
      {ready ? (
        <DemoStage
          scene={scene}
          caption={copy.scenes.hero.caption}
          description={copy.scenes.hero.description}
          size={HERO_STAGE.size}
          compactSize={HERO_STAGE.compactSize}
          compactBelow={HERO_STAGE.compactBelow}
          className={STAGE_IN_FRAME}
        />
      ) : (
        <>
          <p className="sr-only">{copy.scenes.hero.description}</p>
          <StagePlaceholder />
        </>
      )}
    </div>
  );
}
