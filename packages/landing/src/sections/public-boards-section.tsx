"use client";

import { useLandingCopy } from "../copy";
import { LazyMount } from "../lib/lazy-mount";
import { PublicBoardDemo } from "../scenes/public-board/public-board-scene";
import { LandingSection } from "./section";

/** Owner: L4. Public board voting and requests. */
export function PublicBoardsSection() {
  const copy = useLandingCopy().home.publicBoards;
  return (
    <LandingSection id="public-boards" copy={copy}>
      <LazyMount className="aspect-[16/9]">
        <PublicBoardDemo />
      </LazyMount>
    </LandingSection>
  );
}
