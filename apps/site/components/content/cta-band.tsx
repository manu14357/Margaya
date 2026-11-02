import { ArrowRight } from "lucide-react";
import { siteLinks } from "@/lib/site-links";

/**
 * The call to action at the end of a post or guide. It sits in the reading
 * column as a quiet card, because the site footer already closes every page
 * with a full-width invitation.
 */
export function CtaBand({
  title = "Try it on your own work",
  description = "Run Margaya on your own server in a few minutes. It's open source under the AGPL, with every feature included.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <aside
      aria-labelledby="cta-band-title"
      className="rounded-2xl border border-border bg-card p-6 md:p-8"
    >
      <h2
        className="text-balance font-medium text-xl leading-tight md:text-2xl"
        id="cta-band-title"
      >
        {title}
      </h2>
      <p className="mt-2 max-w-xl text-muted-foreground leading-relaxed">
        {description}
      </p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <a
          className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          href={siteLinks.selfHost}
        >
          Self-host it
          <ArrowRight aria-hidden="true" className="size-4" />
        </a>
        <a
          className="inline-flex h-11 items-center justify-center rounded-lg border border-border px-5 font-medium text-sm transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          href={siteLinks.docs}
        >
          Read the docs
        </a>
      </div>
    </aside>
  );
}
