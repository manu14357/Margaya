import { ArrowRight, Clock } from "lucide-react";
import type { Guide } from "@/lib/guides";
import { countSteps, guidePath } from "@/lib/guides";

/** One guide in the guides index: the question, what you'll get, and the effort. */
export function GuideCard({ guide }: { guide: Guide }) {
  const steps = countSteps(guide);

  return (
    <a
      className="group flex h-full flex-col rounded-2xl border border-border/80 bg-card p-6 transition-colors hover:border-foreground/25 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
      href={guidePath(guide.slug)}
    >
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
        <span className="inline-flex items-center gap-1.5">
          <Clock aria-hidden="true" className="size-3.5" />
          {guide.timeNeeded}
        </span>
        {steps > 0 ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{steps} steps</span>
          </>
        ) : null}
      </p>
      <h3 className="mt-4 text-balance font-medium text-lg leading-snug">
        {guide.question}
      </h3>
      <p className="mt-2 flex-1 text-muted-foreground text-sm leading-relaxed">
        {guide.summary}
      </p>
      <span className="mt-6 inline-flex items-center gap-1.5 font-medium text-sm">
        Read the guide
        <ArrowRight
          aria-hidden="true"
          className="size-4 transition-transform group-hover:translate-x-0.5"
        />
      </span>
    </a>
  );
}
