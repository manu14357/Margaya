"use client";

import type { LucideIcon } from "lucide-react";
import {
  Braces,
  Container,
  Languages,
  Scale,
  Server,
  Sparkles,
} from "lucide-react";
import { useLandingCopy } from "../copy";

type FactId =
  | "openSource"
  | "selfHosted"
  | "languages"
  | "singleServer"
  | "api"
  | "ai";

const FACTS: { id: FactId; icon: LucideIcon }[] = [
  { id: "openSource", icon: Scale },
  { id: "selfHosted", icon: Container },
  { id: "languages", icon: Languages },
  { id: "singleServer", icon: Server },
  { id: "api", icon: Braces },
  { id: "ai", icon: Sparkles },
];

/** Six plain facts in one quiet row; no logos or counts we cannot back up. */
export function FactsStrip() {
  const facts = useLandingCopy().home.facts;
  return (
    <section aria-label={facts.label} className="px-4 sm:px-6">
      <ul className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-x-6 gap-y-6 border-border border-y py-8 md:grid-cols-3 lg:grid-cols-6">
        {FACTS.map(({ id, icon: Icon }) => (
          <li key={id} className="flex min-w-0 flex-col gap-1">
            <span className="flex items-center gap-2 font-medium text-foreground text-sm">
              <Icon aria-hidden className="size-4 text-muted-foreground" />
              {facts[id].title}
            </span>
            <span className="text-muted-foreground text-xs leading-relaxed">
              {facts[id].detail}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
