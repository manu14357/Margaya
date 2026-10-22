import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import { GuideCard } from "@/components/content/guide-card";
import { ProductShot } from "@/components/content/product-shot";
import { BlogPostCard } from "@/components/landing/blog-post-card";
import { Footer } from "@/components/landing/footer";
import { breadcrumbJsonLd, JsonLd } from "@/components/landing/json-ld";
import { Navbar } from "@/components/landing/navbar";
import { PageIntro } from "@/components/landing/page-intro";
import { getPosts } from "@/lib/blog";
import { countSteps, guideList, guidePath, guideTopics } from "@/lib/guides";

const SITE = "https://margaya.app";
const DESCRIPTION =
  "Step-by-step guides to setting up Margaya, planning work, connecting AI agents, self-hosting with Docker or Helm, single sign-on, EU data residency and moving from Jira or Trello.";

export const metadata: Metadata = {
  title: "Guides",
  description: DESCRIPTION,
  alternates: { canonical: "/guides" },
  openGraph: {
    type: "website",
    title: "Guides | Margaya",
    description: DESCRIPTION,
    url: `${SITE}/guides`,
  },
};

export default function Page() {
  const posts = getPosts().slice(0, 3);
  const [lead] = guideList;
  const topics = guideTopics
    .map((topic) => ({
      ...topic,
      guides: guideList.filter(
        (guide) => guide.topic === topic.id && guide.slug !== lead.slug,
      ),
    }))
    .filter((topic) => topic.guides.length > 0);

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Margaya", path: "/" },
          { name: "Guides", path: "/guides" },
        ])}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Margaya guides",
          description: DESCRIPTION,
          url: `${SITE}/guides`,
          inLanguage: "en",
          mainEntity: {
            "@type": "ItemList",
            itemListElement: guideList.map((guide, index) => ({
              "@type": "ListItem",
              position: index + 1,
              name: guide.question,
              url: `${SITE}${guidePath(guide.slug)}`,
            })),
          },
        }}
      />
      <Navbar />
      <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
        <section className="px-4 pt-16 pb-12 sm:px-6 md:pt-24 md:pb-16">
          <div className="mx-auto w-full max-w-6xl">
            <PageIntro
              align="center"
              eyebrow="Guides"
              title="Do the thing, step by step"
              description="Practical guides to setting up Margaya, running it on your own server and moving your work across, plus fair answers to the questions teams ask before they choose a tool."
            />

            <nav aria-label="Guide topics" className="mt-10">
              <ul className="flex flex-wrap justify-center gap-2">
                {[
                  { href: "#start-here", label: "Start here" },
                  ...topics.map((topic) => ({
                    href: `#${topic.id}`,
                    label: topic.label,
                  })),
                ].map((link) => (
                  <li key={link.href}>
                    <a
                      className="inline-flex min-h-10 items-center rounded-full border border-border px-4 text-muted-foreground text-sm transition-colors hover:border-foreground/25 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                      href={link.href}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </section>

        <section aria-labelledby="start-here" className="px-4 md:px-6">
          <div className="mx-auto w-full max-w-6xl">
            <a
              className="group grid gap-8 overflow-hidden rounded-2xl border border-border bg-card p-6 transition-colors hover:border-foreground/25 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:items-center md:gap-12 md:p-10"
              href={guidePath(lead.slug)}
            >
              <div>
                <h2
                  className="scroll-mt-24 font-medium text-muted-foreground text-xs uppercase tracking-wider"
                  id="start-here"
                >
                  Start here
                </h2>
                <p className="mt-4 text-balance font-medium text-2xl leading-tight md:text-[2rem] md:leading-[1.15]">
                  {lead.title}
                </p>
                <p className="mt-4 text-muted-foreground leading-relaxed md:text-lg">
                  {lead.summary}
                </p>
                <p className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-sm">
                  <span>{lead.timeNeeded}</span>
                  <span aria-hidden="true">·</span>
                  <span>{countSteps(lead)} steps</span>
                </p>
                <span className="mt-6 inline-flex items-center gap-1.5 font-medium text-sm">
                  Start the guide
                  <ArrowRight
                    aria-hidden="true"
                    className="size-4 transition-transform group-hover:translate-x-0.5"
                  />
                </span>
              </div>
              <ProductShot
                shot={{
                  view: "board",
                  // Decorative here: the card's text already names the guide.
                  alt: "",
                }}
              />
            </a>
          </div>
        </section>

        <div className="space-y-16 px-6 pt-16 pb-20 md:space-y-20 md:pt-20 md:pb-24">
          {topics.map((topic) => (
            <section
              aria-labelledby={topic.id}
              className="mx-auto w-full max-w-6xl"
              key={topic.id}
            >
              <div className="flex flex-col gap-2 border-border/70 border-b pb-5 md:flex-row md:items-baseline md:justify-between">
                <h2 className="scroll-mt-24 font-medium text-2xl" id={topic.id}>
                  {topic.label}
                </h2>
                <p className="text-muted-foreground text-sm">{topic.blurb}</p>
              </div>
              <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {topic.guides.map((guide) => (
                  <li key={guide.slug}>
                    <GuideCard guide={guide} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {posts.length > 0 ? (
          <section
            aria-labelledby="from-the-blog"
            className="border-border/70 border-t px-6 py-16 md:py-20"
          >
            <div className="mx-auto w-full max-w-6xl">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <h2
                  className="font-medium text-2xl md:text-3xl"
                  id="from-the-blog"
                >
                  From the blog
                </h2>
                <a
                  className="text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4"
                  href="/blog"
                >
                  All posts
                </a>
              </div>
              <div className="mt-10 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
                {posts.map((post) => (
                  <BlogPostCard key={post.slug} post={post} />
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
