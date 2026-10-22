"use client";

import { Plus } from "lucide-react";
import { useId, useState } from "react";
import { useLandingCopy } from "../copy";
import { cn } from "../lib/cn";
import { LandingSection } from "./section";

type QuestionKey =
  | "selfHost"
  | "redis"
  | "data"
  | "license"
  | "cost"
  | "languages"
  | "jira"
  | "api"
  | "ai"
  | "aiData";

const QUESTIONS: QuestionKey[] = [
  "selfHost",
  "redis",
  "data",
  "license",
  "cost",
  "languages",
  "jira",
  "api",
  "ai",
  "aiData",
];

/**
 * Honest questions and answers as an accordion: each question is a heading
 * holding a button that controls its answer region. Answers stay in the
 * markup while closed, so they are indexable.
 */
export function FaqSection() {
  const copy = useLandingCopy().home.faq;
  const [open, setOpen] = useState<QuestionKey | null>(null);
  const baseId = useId();

  return (
    <LandingSection id="faq" copy={copy}>
      <div className="divide-y divide-border border-border border-y">
        {QUESTIONS.map((key) => {
          const item = copy.items[key];
          const expanded = open === key;
          const buttonId = `${baseId}-${key}-q`;
          const panelId = `${baseId}-${key}-a`;
          return (
            <div key={key}>
              <h3 className="font-medium text-base text-foreground">
                <button
                  id={buttonId}
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  onClick={() => setOpen(expanded ? null : key)}
                  className="flex w-full items-center justify-between gap-6 rounded-sm py-5 text-start outline-none transition-colors hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {item.question}
                  <Plus
                    aria-hidden
                    className={cn(
                      "size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
                      expanded && "rotate-45",
                    )}
                  />
                </button>
              </h3>
              <section
                id={panelId}
                aria-labelledby={buttonId}
                hidden={!expanded}
                className="pb-5"
              >
                <p className="max-w-3xl text-muted-foreground text-sm leading-relaxed">
                  {item.answer}
                </p>
              </section>
            </div>
          );
        })}
      </div>
    </LandingSection>
  );
}
