"use client";

import { Check } from "lucide-react";
import { useLandingCopy } from "../copy";
import { LazyMount } from "../lib/lazy-mount";
import { AskDemo } from "../scenes";
import { LandingSection, LandingSectionDetail } from "./section";

const PRIVACY_ITEMS = ["model", "local", "stored", "budget", "undo"] as const;

/** Ask AI and Build mode, then agents and how the AI is kept private. */
export function AiSection() {
  const copy = useLandingCopy().home.ai;
  return (
    <LandingSection id="ai" copy={copy}>
      <LazyMount className="aspect-[16/10]">
        <AskDemo />
      </LazyMount>
      <div className="mt-10 grid grid-cols-1 items-start gap-10 lg:grid-cols-2 lg:gap-8">
        <LandingSectionDetail
          title={copy.agents.title}
          description={copy.agents.description}
        />
        <LandingSectionDetail
          title={copy.privacy.title}
          description={copy.privacy.description}
        >
          <ul className="flex flex-col gap-2.5">
            {PRIVACY_ITEMS.map((key) => (
              <li
                key={key}
                className="flex items-start gap-2 text-muted-foreground text-sm leading-relaxed"
              >
                <Check
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0 text-foreground"
                />
                {copy.privacy.items[key]}
              </li>
            ))}
          </ul>
        </LandingSectionDetail>
      </div>
    </LandingSection>
  );
}
