import type { ReactNode } from "react";

/**
 * The quiet card that closes a marketing page: a title, one line and the
 * page's two actions. It matches the home page's final call to action.
 */
export function ClosingCta({
  id,
  title,
  description,
  actions,
}: {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="px-4 pb-20 sm:px-6 md:pb-28">
      <div className="mx-auto w-full max-w-6xl rounded-2xl border border-border bg-card px-6 py-14 text-center md:px-12 md:py-16">
        <h2
          id={id}
          className="mx-auto max-w-2xl text-balance font-medium text-3xl leading-[1.15] tracking-[-0.02em] md:text-[2.5rem]"
        >
          {title}
        </h2>
        {description ? (
          <p className="mx-auto mt-4 max-w-xl text-pretty text-base text-muted-foreground leading-relaxed md:text-lg">
            {description}
          </p>
        ) : null}
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row [&>*]:w-full sm:[&>*]:w-auto">
          {actions}
        </div>
      </div>
    </section>
  );
}
