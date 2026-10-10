import { existsSync } from "node:fs";
import { join } from "node:path";
import { ArrowRight, ArrowUpRight, ChevronDown } from "lucide-react";
import { FadeIn } from "@/components/landing/fade-in";
import { Footer } from "@/components/landing/footer";
import {
  breadcrumbJsonLd,
  faqJsonLd,
  JsonLd,
} from "@/components/landing/json-ld";
import { Navbar } from "@/components/landing/navbar";
import { Button } from "@/components/ui/button";
import {
  alternativePath,
  type Comparison,
  comparisonCategories,
  comparisons,
  MARGAYA_GLANCE,
  type ProductView,
} from "@/lib/comparisons";
import { siteLinks } from "@/lib/site-links";
import { CompareLegend, CompareTable } from "./compare-table";

const JIRA_IMPORT_DOCS = "/docs/core/functional/import-from-jira";
const CSV_IMPORT_DOCS = "/docs/core/functional/import-tasks-from-csv";
const EXPORT_DOCS = "/docs/core/functional/export-tasks";

function formatReviewed(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Product screenshots arrive separately from the pages that use them, so pick
 * the requested view only when both themes exist at build time and fall back
 * to the board otherwise.
 */
function screenshotView(view: ProductView): ProductView {
  const dir = join(process.cwd(), "public", "images", "product");
  const has = (name: ProductView) =>
    existsSync(join(dir, `${name}-light.png`)) &&
    existsSync(join(dir, `${name}-dark.png`));
  return has(view) ? view : "board";
}

function SectionHeading({
  id,
  eyebrow,
  title,
  description,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <header className="max-w-2xl">
      {eyebrow ? (
        <p className="font-medium text-muted-foreground text-sm">{eyebrow}</p>
      ) : null}
      <h2
        id={id}
        className="mt-2 text-balance font-medium text-2xl leading-tight md:text-3xl"
      >
        {title}
      </h2>
      {description ? (
        <p className="mt-3 text-balance text-muted-foreground leading-relaxed">
          {description}
        </p>
      ) : null}
    </header>
  );
}

export function ComparisonPage({ data }: { data: Comparison }) {
  const path = alternativePath(data.slug);
  const view = screenshotView(data.screenshot);
  const related = data.related
    .map((slug) => comparisons[slug])
    .filter((entry): entry is Comparison => Boolean(entry));
  const categoryLabels = comparisonCategories
    .filter((category) => data.categories.includes(category.id))
    .map((category) => category.label);
  const isJira = data.slug === "jira";

  const glance = [
    {
      label: "Hosting",
      margaya: MARGAYA_GLANCE.hosting,
      them: data.glance.hosting,
    },
    {
      label: "Licence",
      margaya: MARGAYA_GLANCE.licence,
      them: data.glance.licence,
    },
    {
      label: "Pricing model",
      margaya: MARGAYA_GLANCE.pricing,
      them: data.glance.pricing,
    },
    {
      label: "Best for",
      margaya: data.glance.margayaBestFor,
      them: data.glance.bestFor,
    },
  ];

  return (
    <>
      <JsonLd data={faqJsonLd(data.faq)} />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Margaya", path: "/" },
          { name: "Alternatives", path: "/alternatives" },
          { name: `Margaya vs ${data.competitor}`, path },
        ])}
      />
      <Navbar />
      <main className="min-h-screen bg-background text-foreground">
        {/* Hero */}
        <section className="px-4 pt-12 pb-14 md:px-6 md:pt-20 md:pb-20">
          <div className="mx-auto w-full max-w-6xl">
            <nav aria-label="Breadcrumb">
              <ol className="flex flex-wrap items-center gap-1.5 text-muted-foreground text-sm">
                <li>
                  <a
                    href="/alternatives"
                    className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                  >
                    Alternatives
                  </a>
                </li>
                <li aria-hidden="true">/</li>
                <li aria-current="page" className="text-foreground">
                  Margaya vs {data.competitor}
                </li>
              </ol>
            </nav>
            <div className="mt-6 grid items-end gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
              <header>
                <h1 className="text-balance font-medium text-4xl leading-[1.05] md:text-6xl">
                  Margaya{" "}
                  <span className="text-muted-foreground">
                    vs {data.competitor}
                  </span>
                </h1>
                <p className="mt-6 max-w-xl text-balance text-lg leading-relaxed md:text-xl">
                  {data.verdict}
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Button
                    size="lg"
                    className="h-12 px-5 text-sm sm:h-12"
                    render={<a href={siteLinks.signUp} />}
                  >
                    Try Margaya Cloud
                    <ArrowRight aria-hidden="true" />
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    className="h-12 px-5 text-sm sm:h-12"
                    render={<a href={siteLinks.selfHost} />}
                  >
                    Self-host for free
                  </Button>
                </div>
                <p className="mt-6 flex flex-wrap gap-x-2 gap-y-1 text-muted-foreground text-xs">
                  <span>{categoryLabels.join(" · ")}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {data.competitor} details reviewed{" "}
                    <time dateTime={data.reviewedOn}>
                      {formatReviewed(data.reviewedOn)}
                    </time>
                  </span>
                </p>
              </header>
              <FadeIn delay={120}>
                <figure className="overflow-hidden rounded-xl border border-border bg-sidebar shadow-sm">
                  {/* biome-ignore lint/performance/noImgElement: the static export serves screenshots as-is, one per theme. */}
                  <img
                    src={`/images/product/${view}-light.png`}
                    alt={`Margaya's ${view} view`}
                    width={1728}
                    height={1000}
                    loading="eager"
                    className="block h-auto w-full dark:hidden"
                  />
                  {/* biome-ignore lint/performance/noImgElement: see above. */}
                  <img
                    src={`/images/product/${view}-dark.png`}
                    alt={`Margaya's ${view} view`}
                    width={1728}
                    height={1000}
                    loading="eager"
                    className="hidden h-auto w-full dark:block"
                  />
                </figure>
              </FadeIn>
            </div>
          </div>
        </section>

        {/* At a glance */}
        <section
          aria-labelledby="compare-glance"
          className="border-border border-t px-4 py-16 md:px-6 md:py-20"
        >
          <div className="mx-auto w-full max-w-6xl">
            <SectionHeading id="compare-glance" title="At a glance" />
            <dl className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {glance.map((item) => (
                <div
                  key={item.label}
                  className="flex flex-col rounded-xl border border-border bg-card p-5"
                >
                  <dt className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    {item.label}
                  </dt>
                  <dd className="mt-4 flex flex-1 flex-col gap-4">
                    <div>
                      <p className="font-medium text-xs">Margaya</p>
                      <p className="mt-1 text-sm leading-relaxed">
                        {item.margaya}
                      </p>
                    </div>
                    <div className="mt-auto border-border border-t pt-4">
                      <p className="font-medium text-muted-foreground text-xs">
                        {data.competitor}
                      </p>
                      <p className="mt-1 text-muted-foreground text-sm leading-relaxed">
                        {item.them}
                      </p>
                    </div>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Feature table */}
        <section
          aria-labelledby="compare-features"
          className="border-border border-t px-4 py-16 md:px-6 md:py-20"
        >
          <div className="mx-auto w-full max-w-6xl">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <SectionHeading
                id="compare-features"
                title="Feature by feature"
                description={`What each tool offers out of the box. Notes qualify a mark; ${data.competitor} plans and add-ons change, so check its site for the details that matter to you.`}
              />
              <CompareLegend />
            </div>
            <div className="mt-10">
              <CompareTable data={data} />
            </div>
          </div>
        </section>

        {/* Where they shine / where Margaya differs */}
        <section
          aria-labelledby="compare-shines"
          className="border-border border-t px-4 py-16 md:px-6 md:py-20"
        >
          <div className="mx-auto grid w-full max-w-6xl gap-14 lg:grid-cols-2 lg:gap-12">
            <div>
              <SectionHeading
                id="compare-shines"
                title={`Where ${data.competitor} shines`}
                description="A fair account of what it does well, and when it is the better pick."
              />
              <ul className="mt-8 space-y-4">
                {data.shines.map((point) => (
                  <li
                    key={point.title}
                    className="rounded-xl border border-border p-5 md:p-6"
                  >
                    <h3 className="font-medium">{point.title}</h3>
                    <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
                      {point.body}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <SectionHeading
                id="compare-different"
                title="Where Margaya is different"
                description="What you get by choosing Margaya instead."
              />
              <ul className="mt-8 space-y-4">
                {data.different.map((point) => (
                  <li
                    key={point.title}
                    className="rounded-xl border border-border bg-sidebar p-5 md:p-6"
                  >
                    <h3 className="font-medium">{point.title}</h3>
                    <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
                      {point.body}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Migration */}
        <section
          aria-labelledby="compare-migrate"
          className="border-border border-t px-4 py-16 md:px-6 md:py-20"
        >
          <div className="mx-auto grid w-full max-w-6xl items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <SectionHeading
              id="compare-migrate"
              eyebrow="Switching"
              title={`Migrating from ${data.competitor}`}
              description={data.migration}
            />
            <ul className="grid gap-3">
              <li>
                <a
                  href={isJira ? JIRA_IMPORT_DOCS : CSV_IMPORT_DOCS}
                  className="group flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-5 outline-none transition-colors hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span>
                    <span className="block font-medium">
                      {isJira ? "Import from Jira" : "Import tasks from CSV"}
                    </span>
                    <span className="mt-1 block text-muted-foreground text-sm leading-relaxed">
                      {isJira
                        ? "Statuses, people, sub-tasks, links, comments, sprints and components."
                        : "Map columns to fields and review every row before anything is created."}
                    </span>
                  </span>
                  <ArrowUpRight
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
                  />
                </a>
              </li>
              <li>
                <a
                  href={EXPORT_DOCS}
                  className="group flex items-start justify-between gap-4 rounded-xl border border-border p-5 outline-none transition-colors hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span>
                    <span className="block font-medium">Export, any time</span>
                    <span className="mt-1 block text-muted-foreground text-sm leading-relaxed">
                      Every project exports to CSV or JSON, so moving on is as
                      easy as moving in.
                    </span>
                  </span>
                  <ArrowUpRight
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
                  />
                </a>
              </li>
            </ul>
          </div>
        </section>

        {/* FAQ */}
        <section
          aria-labelledby="compare-faq"
          className="border-border border-t px-4 py-16 md:px-6 md:py-20"
        >
          <div className="mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <SectionHeading
              id="compare-faq"
              title="Questions"
              description={`Common questions from teams weighing Margaya against ${data.competitor}.`}
            />
            <div className="divide-y divide-border border-border border-y">
              {data.faq.map((entry, index) => (
                <details
                  key={entry.question}
                  className="group"
                  open={index === 0}
                >
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-4 py-5 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    <h3>{entry.question}</h3>
                    <ChevronDown
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
                    />
                  </summary>
                  <p className="-mt-1 pb-5 text-muted-foreground leading-relaxed">
                    {entry.answer}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {related.length > 0 ? (
          <nav
            aria-labelledby="compare-related"
            className="border-border border-t px-4 py-14 md:px-6 md:py-16"
          >
            <div className="mx-auto w-full max-w-6xl">
              <div className="flex flex-wrap items-baseline justify-between gap-4">
                <h2 id="compare-related" className="font-medium text-xl">
                  Other comparisons
                </h2>
                <a
                  href="/alternatives"
                  className="rounded-sm text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                >
                  All alternatives
                </a>
              </div>
              <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {related.map((entry) => (
                  <li key={entry.slug}>
                    <a
                      href={alternativePath(entry.slug)}
                      className="group flex h-full flex-col rounded-xl border border-border bg-card p-5 outline-none transition-colors hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex items-center justify-between gap-2 font-medium">
                        Margaya vs {entry.competitor}
                        <ArrowRight
                          aria-hidden="true"
                          className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                        />
                      </span>
                      <span className="mt-1.5 line-clamp-2 text-muted-foreground text-sm leading-relaxed">
                        {entry.summary}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
        ) : null}
        {/* Final CTA */}
        <section
          aria-labelledby="compare-cta"
          className="px-4 pt-4 pb-16 md:px-6 md:pb-20"
        >
          <div className="mx-auto w-full max-w-6xl rounded-2xl bg-primary px-6 py-14 text-center text-primary-foreground md:px-12 md:py-16">
            <h2
              id="compare-cta"
              className="mx-auto max-w-2xl text-balance font-medium text-3xl leading-tight md:text-4xl"
            >
              See how your team works in Margaya
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-balance text-lg leading-relaxed opacity-75">
              Start in Margaya Cloud, or run it on your own server for free. The
              product is the same either way.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href={siteLinks.signUp}
                className="inline-flex h-12 items-center gap-2 rounded-lg bg-primary-foreground px-5 font-medium text-primary text-sm outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
              >
                Try Margaya Cloud
                <ArrowRight aria-hidden="true" className="size-4" />
              </a>
              <a
                href={siteLinks.selfHost}
                className="inline-flex h-12 items-center rounded-lg border border-primary-foreground/25 px-5 font-medium text-sm outline-none transition-colors hover:bg-primary-foreground/10 focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
              >
                Read the install guide
              </a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
