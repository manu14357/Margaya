"use client";

import type { LucideIcon } from "lucide-react";
import { Braces, Container, Languages, Scale, Server } from "lucide-react";
import { useLandingCopy } from "../copy";

type FactId =
  | "openSource"
  | "selfHosted"
  | "languages"
  | "singleServer"
  | "api";

const FACTS: { id: FactId; icon: LucideIcon }[] = [
  { id: "openSource", icon: Scale },
  { id: "selfHosted", icon: Container },
  { id: "languages", icon: Languages },
  { id: "singleServer", icon: Server },
  { id: "api", icon: Braces },
];

/** Owner: L1. Five plain facts; no logos or counts we cannot back up. */
export function FactsStrip() {
  const facts = useLandingCopy().home.facts;
  return (
    <section aria-label={facts.label} className="border-border border-y px-6">
      <ul className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-px py-6 md:grid-cols-5 md:py-8">
        {FACTS.map(({ id, icon: Icon }) => (
          <li
            key={id}
            className="flex items-start gap-3 px-2 py-3 last:col-span-2 md:last:col-span-1"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
              <Icon aria-hidden className="size-4" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="font-medium text-foreground text-sm">
                {facts[id].title}
              </span>
              <span className="text-muted-foreground text-xs">
                {facts[id].detail}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
