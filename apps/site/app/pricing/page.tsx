import { ArrowRight, Check, Minus, Plus } from "lucide-react";
import type { Metadata } from "next";
import { Footer } from "@/components/landing/footer";
import { breadcrumbJsonLd, JsonLd } from "@/components/landing/json-ld";
import { Navbar } from "@/components/landing/navbar";
import { PageIntro } from "@/components/landing/page-intro";
import { PricingPlans } from "@/components/landing/pricing-plans";
import { comparison, type PlanCell, pricing } from "@/lib/pricing";
import { siteLinks } from "@/lib/site-links";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: pricing.eyebrow,
  description: pricing.metaDescription,
  alternates: { canonical: "/pricing" },
};

const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const planNames = [
  pricing.plans.selfHosted.name,
  pricing.plans.personal.name,
  pricing.plans.team.name,
];

function Cell({ value }: { value: PlanCell }) {
  if (value === true) {
    return (
      <>
        <Check aria-hidden className="mx-auto size-4 text-foreground" />
        <span className="sr-only">{pricing.table.included}</span>
      </>
    );
  }
  if (value === false) {
    return (
      <>
        <Minus aria-hidden className="mx-auto size-4 text-foreground/30" />
        <span className="sr-only">{pricing.table.notIncluded}</span>
      </>
    );
  }
  return <span>{pricing.table.values[value]}</span>;
}

const faq = Object.values(pricing.faq.items);

export default function PricingPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Margaya", path: "/" },
          { name: pricing.eyebrow, path: "/pricing" },
        ])}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faq.map((item) => ({
            "@type": "Question",
            name: item.question,
            acceptedAnswer: { "@type": "Answer", text: item.answer },
          })),
        }}
      />
      <Navbar />
      <main className="min-h-screen bg-background text-foreground">
        <section className="px-4 pt-14 pb-16 md:px-6 md:pt-20 md:pb-20 lg:pt-24">
          <div className="mx-auto w-full max-w-6xl">
            <PageIntro
              eyebrow={pricing.eyebrow}
              title={pricing.title}
              description={pricing.description}
            />
            <div className="mt-12">
              <PricingPlans />
            </div>
          </div>
        </section>

        <section
          aria-labelledby="compare-title"
          className="border-border border-t px-4 py-16 md:px-6 md:py-24"
        >
          <div className="mx-auto w-full max-w-6xl">
            <div className="max-w-2xl">
              <h2
                id="compare-title"
                className="text-balance font-medium text-3xl leading-tight md:text-4xl"
              >
                {pricing.table.title}
              </h2>
              <p className="mt-4 text-balance text-lg text-muted-foreground leading-relaxed">
                {pricing.table.description}
              </p>
            </div>
            <div className="relative mt-10 overflow-x-auto rounded-2xl border border-border">
              <table className="w-full min-w-[40rem] border-collapse text-sm">
                <caption className="sr-only">{pricing.table.title}</caption>
                <thead>
                  <tr className="bg-sidebar">
                    <th
                      scope="col"
                      className="w-[34%] px-5 py-4 text-left font-medium text-muted-foreground"
                    >
                      {pricing.table.feature}
                    </th>
                    {planNames.map((name, index) => (
                      <th
                        key={name}
                        scope="col"
                        className={cn(
                          "w-[22%] px-4 py-4 text-center font-medium",
                          index === 2 && "bg-foreground/[0.04]",
                        )}
                      >
                        {name}
                      </th>
                    ))}
                  </tr>
                </thead>
                {comparison.map((group) => (
                  <tbody key={group.group}>
                    <tr>
                      <th
                        scope="colgroup"
                        colSpan={4}
                        className="border-border border-t bg-background px-5 pt-6 pb-2 text-left font-medium text-muted-foreground text-xs uppercase tracking-[0.08em]"
                      >
                        {pricing.table.groups[group.group]}
                      </th>
                    </tr>
                    {group.rows.map((row) => (
                      <tr key={row.key} className="border-border border-t">
                        <th
                          scope="row"
                          className="px-5 py-3.5 text-left font-normal text-foreground/85"
                        >
                          {pricing.table.rows[row.key]}
                        </th>
                        {row.cells.map((cell, index) => (
                          <td
                            // biome-ignore lint/suspicious/noArrayIndexKey: The columns are fixed: one per plan.
                            key={index}
                            className={cn(
                              "px-4 py-3.5 text-center text-foreground/85",
                              index === 2 && "bg-foreground/[0.04]",
                            )}
                          >
                            <Cell value={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          </div>
        </section>

        <section
          aria-labelledby="faq-title"
          className="border-border border-t px-4 py-16 md:px-6 md:py-24"
        >
          <div className="mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-16">
            <h2
              id="faq-title"
              className="text-balance font-medium text-3xl leading-tight md:text-4xl lg:sticky lg:top-24 lg:self-start"
            >
              {pricing.faq.title}
            </h2>
            <div className="border-border border-t">
              {faq.map((item) => (
                <details
                  key={item.question}
                  className="group border-border border-b"
                >
                  <summary
                    className={cn(
                      "flex cursor-pointer list-none items-center justify-between gap-4 rounded-sm py-5 font-medium text-base [&::-webkit-details-marker]:hidden",
                      FOCUS,
                    )}
                  >
                    {item.question}
                    <Plus
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-45 motion-reduce:transition-none"
                    />
                  </summary>
                  <p className="max-w-2xl pb-5 text-muted-foreground leading-relaxed">
                    {item.answer}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 pb-20 md:px-6 md:pb-28">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 rounded-2xl border border-border bg-sidebar p-8 md:flex-row md:items-end md:justify-between md:p-12">
            <div className="max-w-2xl">
              <h2 className="text-balance font-medium text-3xl leading-tight md:text-4xl">
                {pricing.cta.title}
              </h2>
              <p className="mt-4 text-balance text-lg text-muted-foreground leading-relaxed">
                {pricing.cta.description}
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
              <a
                href={siteLinks.signUp}
                className={cn(
                  "inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-primary bg-primary px-5 font-medium text-primary-foreground text-sm shadow-primary/24 shadow-xs transition-colors hover:bg-primary/90",
                  FOCUS,
                )}
              >
                {pricing.cta.primary}
                <ArrowRight aria-hidden className="size-4" />
              </a>
              <a
                href={siteLinks.selfHost}
                className={cn(
                  "inline-flex h-12 items-center justify-center rounded-lg border border-input bg-popover px-5 font-medium text-foreground text-sm shadow-xs/5 transition-colors hover:bg-accent/50 dark:bg-input/32 dark:hover:bg-input/64",
                  FOCUS,
                )}
              >
                {pricing.cta.secondary}
              </a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
