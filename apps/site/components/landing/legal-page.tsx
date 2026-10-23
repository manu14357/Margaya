import { CalendarDays, Check, Info } from "lucide-react";
import type { ReactNode } from "react";
import { Footer } from "@/components/landing/footer";
import { breadcrumbJsonLd, JsonLd } from "@/components/landing/json-ld";
import { Navbar } from "@/components/landing/navbar";
import { OnThisPage } from "@/components/landing/on-this-page";
import { PageIntro } from "@/components/landing/page-intro";
import {
  type LegalBlock,
  type LegalDocument,
  legalChrome,
} from "@/lib/legal/types";

const INLINE = /\*\*(.+?)\*\*|\[(.+?)\]\((.+?)\)|`(.+?)`/g;

/** Renders `**bold**`, `[label](href)` and `code` inside a sentence. */
function Inline({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    const [, bold, label, href, code] = match;
    if (bold) {
      parts.push(
        <strong key={index} className="font-medium text-foreground">
          {bold}
        </strong>,
      );
    } else if (label && href) {
      const external = /^https?:\/\//.test(href);
      parts.push(
        <a
          key={index}
          href={href}
          {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
          className="rounded-sm font-medium text-foreground underline decoration-foreground/25 underline-offset-4 outline-none hover:decoration-current focus-visible:ring-2 focus-visible:ring-ring"
        >
          {label}
        </a>,
      );
    } else if (code) {
      parts.push(
        <code
          key={index}
          className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground"
        >
          {code}
        </code>,
      );
    }
    last = index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function Block({ block }: { block: LegalBlock }) {
  if (block.type === "p") {
    return (
      <p>
        <Inline text={block.text} />
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2.5">
      {block.items.map((item) => (
        <li key={item} className="relative pl-5">
          <span
            aria-hidden
            className="absolute top-[0.7em] left-0 size-1.5 rounded-full bg-foreground/30"
          />
          <Inline text={item} />
        </li>
      ))}
    </ul>
  );
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

/** A legal document: intro, the short version, then numbered sections. */
export function LegalPage({
  document,
  related,
}: {
  document: LegalDocument;
  related: { label: string; href: string };
}) {
  const toc = document.sections.map((section) => ({
    id: section.id,
    label: section.title,
  }));

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Margaya", path: "/" },
          { name: document.title, path: document.path },
        ])}
      />
      <Navbar />
      <main className="min-h-screen bg-background text-foreground">
        <section className="px-4 pt-16 pb-12 sm:px-6 md:pt-24 md:pb-16">
          <div className="mx-auto w-full max-w-6xl">
            <PageIntro
              eyebrow={legalChrome.eyebrow}
              title={document.title}
              description={document.intro}
            >
              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-muted-foreground text-sm">
                <p className="inline-flex items-center gap-2">
                  <CalendarDays aria-hidden className="size-4" />
                  {legalChrome.updated}{" "}
                  <time dateTime={document.updated} className="text-foreground">
                    {formatDate(document.updated)}
                  </time>
                </p>
                <p>
                  {legalChrome.related}:{" "}
                  <a
                    href={related.href}
                    className="rounded-sm font-medium text-foreground underline decoration-foreground/25 underline-offset-4 outline-none hover:decoration-current focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {related.label}
                  </a>
                </p>
              </div>
            </PageIntro>
          </div>
        </section>

        <div className="px-4 pb-20 md:px-6 md:pb-28">
          <div className="mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-16">
            <OnThisPage
              title={legalChrome.onThisPage}
              items={toc}
              className="max-lg:hidden"
            />
            <article className="min-w-0 max-w-[68ch]">
              <section
                aria-labelledby="summary-title"
                className="rounded-2xl border border-border bg-card p-6"
              >
                <h2 id="summary-title" className="font-medium text-lg">
                  {document.summaryTitle}
                </h2>
                <ul className="mt-4 flex flex-col gap-3">
                  {document.summary.map((item) => (
                    <li
                      key={item}
                      className="flex gap-3 text-foreground/85 leading-relaxed"
                    >
                      <Check
                        aria-hidden
                        className="mt-1 size-4 shrink-0 text-foreground"
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
              <p className="mt-4 flex gap-3 rounded-xl border border-border border-dashed px-4 py-3 text-muted-foreground text-sm leading-relaxed">
                <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
                {legalChrome.notice}
              </p>

              {document.sections.map((section, index) => (
                <section
                  key={section.id}
                  id={section.id}
                  aria-labelledby={`${section.id}-title`}
                  className="mt-12 scroll-mt-24"
                >
                  <h2
                    id={`${section.id}-title`}
                    className="flex items-baseline gap-3 text-balance font-medium text-foreground text-xl leading-snug md:text-2xl"
                  >
                    <span
                      aria-hidden
                      className="font-mono text-muted-foreground text-sm"
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {section.title}
                  </h2>
                  <div className="mt-4 flex flex-col gap-4 text-[0.9375rem] text-foreground/85 leading-7 md:text-base">
                    {section.blocks.map((block) => (
                      <Block
                        key={block.type === "p" ? block.text : block.items[0]}
                        block={block}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </article>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
