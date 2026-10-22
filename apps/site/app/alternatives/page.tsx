import type { Metadata } from "next";
import {
  type AlternativeCard,
  AlternativesGrid,
} from "@/components/compare/alternatives-grid";
import { ContentCard } from "@/components/landing/content-card";
import { Footer } from "@/components/landing/footer";
import { breadcrumbJsonLd, JsonLd } from "@/components/landing/json-ld";
import { Navbar } from "@/components/landing/navbar";
import { PageIntro } from "@/components/landing/page-intro";
import { formatBlogDateShort } from "@/lib/blog/format";
import {
  alternativePath,
  cellMark,
  compareFeatures,
  comparisonCategories,
  comparisonList,
} from "@/lib/comparisons";
import { guideList, guidePath } from "@/lib/guides";

const description =
  "Compare Margaya with Jira, Trello, Asana, Linear, monday.com, ClickUp, Notion and 15 more tools: features, hosting, licences and how to migrate your work.";

export const metadata: Metadata = {
  title: "Margaya alternatives and comparisons",
  description,
  alternates: { canonical: "/alternatives" },
  openGraph: {
    type: "website",
    siteName: "Margaya",
    title: "Margaya alternatives and comparisons | Margaya",
    description,
    url: "https://margaya.app/alternatives",
    images: [
      { url: "/og-image.png", width: 1200, height: 630, alt: "Margaya" },
    ],
  },
};

const principles = [
  {
    title: "Same rows for every tool",
    body: `Each page compares the same ${Object.keys(compareFeatures).length} capabilities across planning, views, docs, intake, automation, hosting and pricing.`,
  },
  {
    title: "Their strengths first",
    body: "Every comparison says where the other tool shines and who should pick it, before it says anything about Margaya.",
  },
  {
    title: "A way across",
    body: "Each page links the import that fits: Jira's own CSV export, or Margaya's CSV import with column mapping for the rest.",
  },
];

export default function Page() {
  const cards: AlternativeCard[] = comparisonList.map((comparison) => ({
    slug: comparison.slug,
    href: alternativePath(comparison.slug),
    competitor: comparison.competitor,
    summary: comparison.summary,
    categories: comparison.categories,
    categoryLabels: comparisonCategories
      .filter((category) => comparison.categories.includes(category.id))
      .map((category) => category.label),
    // The open-source category already says it can be self-hosted.
    hostingTag: comparison.categories.includes("open-source")
      ? undefined
      : cellMark(comparison.them.selfHost) === "no"
        ? "Cloud only"
        : "Self-hostable",
  }));

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Margaya", path: "/" },
          { name: "Alternatives", path: "/alternatives" },
        ])}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: "Margaya comparisons",
          itemListElement: comparisonList.map((comparison, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: `Margaya vs ${comparison.competitor}`,
            url: `https://margaya.app${alternativePath(comparison.slug)}`,
          })),
        }}
      />
      <Navbar />
      <main className="min-h-screen bg-background text-foreground">
        <section className="px-4 pt-16 pb-12 sm:px-6 md:pt-24 md:pb-16">
          <div className="mx-auto w-full max-w-6xl">
            <PageIntro
              align="center"
              eyebrow="Alternatives"
              title="How Margaya compares"
              description={`Margaya is open-source project management you can run yourself or use in the cloud. Here it is next to ${comparisonList.length} tools teams often weigh it against, compared feature by feature, with an honest word on when each one is the better choice.`}
            />
            <aside
              aria-label="How these comparisons are written"
              className="mx-auto mt-10 max-w-2xl rounded-xl border border-border bg-card p-5 text-center text-sm leading-relaxed md:p-6"
            >
              <p className="font-medium">We build Margaya.</p>
              <p className="mt-2 text-muted-foreground">
                Read these pages with that in mind. We keep claims about other
                tools general and note when each page was last reviewed. If
                something is out of date, tell us on GitHub and we will fix it.
              </p>
            </aside>
          </div>
        </section>

        <section
          aria-label="Comparisons"
          className="px-4 py-12 sm:px-6 md:py-16"
        >
          <div className="mx-auto w-full max-w-6xl">
            <AlternativesGrid cards={cards} categories={comparisonCategories} />
          </div>
        </section>

        <section
          aria-labelledby="alternatives-method"
          className="px-4 py-16 sm:px-6 md:py-24"
        >
          <div className="mx-auto w-full max-w-6xl">
            <h2
              id="alternatives-method"
              className="max-w-2xl text-balance font-medium text-3xl leading-[1.15] tracking-[-0.02em] md:text-4xl"
            >
              What every comparison covers
            </h2>
            <ul className="mt-10 grid gap-4 md:grid-cols-3">
              {principles.map((item) => (
                <li
                  key={item.title}
                  className="rounded-xl border border-border bg-card p-6 md:p-8"
                >
                  <h3 className="font-medium">{item.title}</h3>
                  <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
                    {item.body}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {guideList.length > 0 ? (
          <section
            aria-labelledby="alternatives-guides"
            className="px-4 py-16 sm:px-6 md:py-24"
          >
            <div className="mx-auto w-full max-w-6xl">
              <div className="flex flex-wrap items-baseline justify-between gap-4">
                <h2
                  id="alternatives-guides"
                  className="font-medium text-3xl leading-[1.15] tracking-[-0.02em] md:text-4xl"
                >
                  Still choosing? Start with a guide
                </h2>
                <a
                  className="rounded-sm text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                  href="/guides"
                >
                  All guides
                </a>
              </div>
              <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {guideList.slice(0, 3).map((guide) => (
                  <ContentCard
                    body={guide.summary}
                    href={guidePath(guide.slug)}
                    key={guide.slug}
                    meta={[
                      "Guide",
                      <time dateTime={guide.updatedOn} key="updated">
                        Updated {formatBlogDateShort(guide.updatedOn)}
                      </time>,
                    ]}
                    title={guide.question}
                  />
                ))}
              </div>
            </div>
          </section>
        ) : null}
      </main>
      <Footer />
    </>
  );
}
