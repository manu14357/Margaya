import {
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  Clock,
  ListOrdered,
} from "lucide-react";
import { Callout } from "@/components/content/callout";
import { CodeBlock } from "@/components/content/code-block";
import { CtaBand } from "@/components/content/cta-band";
import { InlineText } from "@/components/content/inline-text";
import { ProductShot } from "@/components/content/product-shot";
import { ReadingProgress } from "@/components/content/reading-progress";
import { Footer } from "@/components/landing/footer";
import {
  breadcrumbJsonLd,
  faqJsonLd,
  JsonLd,
} from "@/components/landing/json-ld";
import { Navbar } from "@/components/landing/navbar";
import { Toc, TocDisclosure, type TocEntry } from "@/components/landing/toc";
import type { Guide, GuideStep } from "@/lib/guides";
import { countSteps, guidePath, guideTopics } from "@/lib/guides";

const SITE = "https://margaya.app";
const LINK =
  "transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4";

/** A YYYY-MM-DD date as "15 October 2026", the same in every time zone. */
function formatDate(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Guide copy marks code with backticks; structured data wants plain text. */
function plain(text: string) {
  return text.replaceAll("`", "");
}

function sectionId(index: number) {
  return `section-${index + 1}`;
}

function stepId(number: number) {
  return `step-${number}`;
}

/** Numbers every step across the guide, so "step 4" means one thing. */
function numberSteps(guide: Guide) {
  let number = 0;
  return guide.sections.map((section) =>
    (section.steps ?? []).map((step) => {
      number += 1;
      return { step, number };
    }),
  );
}

function outline(guide: Guide, numbered: ReturnType<typeof numberSteps>) {
  const entries: TocEntry[] = [];
  guide.sections.forEach((section, index) => {
    entries.push({ id: sectionId(index), text: section.heading, depth: 2 });
    for (const { step, number } of numbered[index]) {
      entries.push({
        id: stepId(number),
        text: `${number}. ${step.title}`,
        depth: 3,
      });
    }
  });
  if (guide.faq.length > 0) {
    entries.push({ id: "faq", text: "Questions", depth: 2 });
  }
  entries.push({ id: "next-steps", text: "Next steps", depth: 2 });
  return entries;
}

function Paragraphs({ lines }: { lines?: string[] }) {
  if (!lines?.length) return null;
  return (
    <>
      {lines.map((line) => (
        <p className="mt-4 first:mt-0" key={line.slice(0, 48)}>
          <InlineText text={line} />
        </p>
      ))}
    </>
  );
}

function Step({ step, number }: { step: GuideStep; number: number }) {
  return (
    <li className="group/step relative grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-4 pb-12 last:pb-0 md:grid-cols-[2.5rem_minmax(0,1fr)] md:gap-x-6">
      <span
        aria-hidden="true"
        className="absolute top-11 bottom-0 left-[1.125rem] w-px bg-border group-last/step:hidden md:left-5"
      />
      <span
        aria-hidden="true"
        className="relative flex size-9 items-center justify-center rounded-full border border-border bg-background font-medium font-mono text-sm tabular-nums md:size-10"
      >
        {number}
      </span>
      <div className="min-w-0 pt-1 md:pt-1.5">
        <h3
          className="scroll-mt-24 text-balance font-medium text-foreground text-lg leading-snug md:text-xl"
          id={stepId(number)}
        >
          <span className="sr-only">Step {number}: </span>
          {step.title}
        </h3>
        <div className="mt-3 text-foreground/80 leading-relaxed">
          <Paragraphs lines={step.body} />
        </div>
        {step.bullets ? (
          <ul className="mt-4 space-y-2 text-foreground/80 leading-relaxed">
            {step.bullets.map((bullet) => (
              <li className="flex gap-3" key={bullet}>
                <span
                  aria-hidden="true"
                  className="mt-[0.6rem] size-1.5 shrink-0 rounded-full bg-foreground/35"
                />
                <span>
                  <InlineText text={bullet} />
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {step.code ? (
          <div className="mt-5">
            <CodeBlock content={step.code.content} label={step.code.label} />
          </div>
        ) : null}
        {step.callout ? (
          <Callout callout={step.callout} className="mt-5" />
        ) : null}
        {step.shot ? <ProductShot className="mt-6" shot={step.shot} /> : null}
      </div>
    </li>
  );
}

export function GuidePage({ data }: { data: Guide }) {
  const path = guidePath(data.slug);
  const numbered = numberSteps(data);
  const toc = outline(data, numbered);
  const steps = countSteps(data);
  const topic = guideTopics.find((entry) => entry.id === data.topic);

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Margaya", path: "/" },
          { name: "Guides", path: "/guides" },
          { name: data.question, path },
        ])}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "TechArticle",
          headline: data.title,
          alternativeHeadline: data.question,
          description: data.description,
          datePublished: data.updatedOn,
          dateModified: data.updatedOn,
          inLanguage: "en",
          url: `${SITE}${path}`,
          mainEntityOfPage: `${SITE}${path}`,
          image: `${SITE}/og-image.png`,
          author: { "@type": "Organization", name: "Margaya team", url: SITE },
          publisher: {
            "@type": "Organization",
            name: "Margaya",
            url: SITE,
            logo: `${SITE}/logo-512.png`,
          },
        }}
      />
      {steps > 0 ? (
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "HowTo",
            name: data.title,
            description: data.description,
            step: numbered.flat().map(({ step, number }) => ({
              "@type": "HowToStep",
              position: number,
              name: step.title,
              text: plain(step.body.join(" ")),
              url: `${SITE}${path}#${stepId(number)}`,
            })),
          }}
        />
      ) : null}
      {data.faq.length > 0 ? (
        <JsonLd
          data={faqJsonLd(
            data.faq.map((entry) => ({
              question: entry.question,
              answer: plain(entry.answer),
            })),
          )}
        />
      ) : null}

      <ReadingProgress targetId="guide-body" />
      <Navbar />
      <main
        className="min-h-screen bg-[var(--background)] text-[var(--foreground)]"
        id="top"
      >
        <header className="px-6 pt-12 pb-10 md:pt-20 md:pb-14">
          <div className="mx-auto w-full max-w-3xl">
            <nav aria-label="Breadcrumb">
              <ol className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
                <li>
                  <a
                    className={`inline-flex items-center gap-1.5 ${LINK}`}
                    href="/guides"
                  >
                    <ArrowLeft aria-hidden="true" className="size-3.5" />
                    Guides
                  </a>
                </li>
                {topic ? (
                  <>
                    <li aria-hidden="true">/</li>
                    <li>
                      <a className={LINK} href={`/guides#${topic.id}`}>
                        {topic.label}
                      </a>
                    </li>
                  </>
                ) : null}
              </ol>
            </nav>
            <h1 className="mt-6 text-balance font-medium text-[2.5rem] leading-[1.08] tracking-[-0.03em] md:text-[3.25rem]">
              {data.question}
            </h1>
            <p className="mt-6 text-balance text-lg text-muted-foreground leading-relaxed md:text-xl">
              {data.description}
            </p>
            <ul className="mt-8 flex flex-wrap gap-2 text-sm">
              <li className="inline-flex items-center gap-2 rounded-full border border-border/80 px-3 py-1.5">
                <Clock
                  aria-hidden="true"
                  className="size-3.5 text-muted-foreground"
                />
                {data.timeNeeded}
              </li>
              {steps > 0 ? (
                <li className="inline-flex items-center gap-2 rounded-full border border-border/80 px-3 py-1.5">
                  <ListOrdered
                    aria-hidden="true"
                    className="size-3.5 text-muted-foreground"
                  />
                  {steps} steps
                </li>
              ) : null}
              <li className="inline-flex items-center rounded-full border border-border/80 px-3 py-1.5 text-muted-foreground">
                Updated{" "}
                <time
                  className="ml-1 text-foreground"
                  dateTime={data.updatedOn}
                >
                  {formatDate(data.updatedOn)}
                </time>
              </li>
            </ul>

            <div className="mt-10 rounded-2xl border border-border/80 bg-card p-6 md:p-7">
              <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                The short answer
              </h2>
              <p className="mt-3 text-foreground/85 text-lg leading-relaxed">
                {data.answer}
              </p>
            </div>

            {data.before?.length ? (
              <div className="mt-6 rounded-2xl border border-border/80 border-dashed p-6 md:p-7">
                <h2 className="font-medium text-sm">Before you start</h2>
                <ul className="mt-4 space-y-2.5 text-foreground/80 text-sm leading-relaxed">
                  {data.before.map((line) => (
                    <li className="flex gap-3" key={line}>
                      <CircleCheck
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      />
                      <InlineText text={line} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </header>

        <div className="px-6 pb-20 md:pb-24">
          <div className="mx-auto grid w-full max-w-3xl gap-10 lg:max-w-6xl lg:grid-cols-[14rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,46rem)_13rem] xl:justify-between">
            <aside className="max-lg:hidden">
              <div className="sticky top-24">
                <Toc entries={toc} label="In this guide" />
              </div>
            </aside>

            <article className="min-w-0" id="guide-body">
              <div className="mb-10 lg:hidden">
                <TocDisclosure entries={toc} label="In this guide" />
              </div>

              <div className="space-y-16">
                {data.sections.map((section, index) => (
                  <section
                    aria-labelledby={sectionId(index)}
                    key={section.heading}
                  >
                    <h2
                      className="scroll-mt-24 text-balance font-medium text-2xl leading-tight md:text-3xl"
                      id={sectionId(index)}
                    >
                      {section.heading}
                    </h2>
                    {section.body ? (
                      <div className="mt-4 text-foreground/80 text-[1.0625rem] leading-relaxed">
                        <Paragraphs lines={section.body} />
                      </div>
                    ) : null}

                    {section.items ? (
                      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
                        {section.items.map((item) => (
                          <li
                            className="flex flex-col rounded-xl border border-border/80 bg-card p-5"
                            key={item.name}
                          >
                            <h3 className="font-medium text-base">
                              {item.href ? (
                                <a
                                  className="underline decoration-border underline-offset-4 transition-colors hover:decoration-current focus-visible:outline-2 focus-visible:outline-ring"
                                  href={item.href}
                                >
                                  {item.name}
                                </a>
                              ) : (
                                item.name
                              )}
                            </h3>
                            {item.meta ? (
                              <p className="mt-1 text-muted-foreground text-xs">
                                {item.meta}
                              </p>
                            ) : null}
                            <p className="mt-3 text-foreground/75 text-sm leading-relaxed">
                              <InlineText text={item.body} />
                            </p>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {section.callout ? (
                      <Callout callout={section.callout} className="mt-6" />
                    ) : null}
                    {section.shot ? (
                      <ProductShot className="mt-8" shot={section.shot} />
                    ) : null}

                    {numbered[index].length > 0 ? (
                      <ol className="mt-10">
                        {numbered[index].map(({ step, number }) => (
                          <Step key={number} number={number} step={step} />
                        ))}
                      </ol>
                    ) : null}
                  </section>
                ))}

                {data.faq.length > 0 ? (
                  <section aria-labelledby="faq">
                    <h2
                      className="scroll-mt-24 font-medium text-2xl leading-tight md:text-3xl"
                      id="faq"
                    >
                      Questions
                    </h2>
                    <div className="mt-6 divide-y divide-border/70 border-border/70 border-y">
                      {data.faq.map((entry) => (
                        <details className="group py-1" key={entry.question}>
                          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 font-medium focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                            <h3 className="text-base">{entry.question}</h3>
                            <span
                              aria-hidden="true"
                              className="text-muted-foreground text-xl leading-none transition-transform group-open:rotate-45"
                            >
                              +
                            </span>
                          </summary>
                          <p className="pb-5 text-foreground/75 leading-relaxed">
                            <InlineText text={entry.answer} />
                          </p>
                        </details>
                      ))}
                    </div>
                  </section>
                ) : null}

                <section aria-labelledby="next-steps">
                  <h2
                    className="scroll-mt-24 font-medium text-2xl leading-tight md:text-3xl"
                    id="next-steps"
                  >
                    Next steps
                  </h2>
                  <ul className="mt-6 grid gap-3 sm:grid-cols-3">
                    {data.next.map((link) => (
                      <li key={link.href}>
                        <a
                          className="group flex h-full flex-col rounded-xl border border-border/80 p-5 transition-colors hover:border-foreground/25 hover:bg-card focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                          href={link.href}
                        >
                          <span className="flex items-start justify-between gap-3 font-medium text-sm">
                            {link.label}
                            <ArrowRight
                              aria-hidden="true"
                              className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                            />
                          </span>
                          <span className="mt-2 text-muted-foreground text-sm leading-relaxed">
                            {link.description}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>

                <CtaBand />
              </div>
            </article>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
