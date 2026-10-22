import { BookOpen, House, LayoutGrid } from "lucide-react";
import type { Metadata } from "next";
import {
  type FinderLink,
  NotFoundFinder,
} from "@/components/content/not-found-finder";
import { Footer } from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { featurePageList, featurePath } from "@/lib/features";
import { siteLinks } from "@/lib/site-links";

// One <title> only: the layout's template turns this into "Page not found | Margaya".
export const metadata: Metadata = {
  title: "Page not found",
  description:
    "This address doesn't lead to a page on margaya.app. Find what you were looking for in the docs, the feature pages or the guides.",
  robots: { index: false, follow: true },
};

const links: FinderLink[] = [
  {
    label: "Home",
    hint: "What Margaya is, in one page",
    href: "/",
    group: "Site",
    keywords: "start landing overview",
  },
  ...featurePageList.map((page) => ({
    // The "Docs" feature is project pages; say so, next to the real docs.
    label: page.slug === "docs" ? "Pages" : page.copy.eyebrow,
    hint: page.copy.metaTitle,
    href: featurePath(page.slug),
    group: "Features",
  })),
  {
    label: "Documentation",
    hint: "How every part of Margaya works",
    href: siteLinks.docs,
    group: "Docs",
    keywords: "help manual reference",
  },
  {
    label: "Install with Docker",
    hint: "Run Margaya on your own server",
    href: siteLinks.selfHost,
    group: "Docs",
    keywords: "self-host compose helm kubernetes install",
  },
  {
    label: "API reference",
    hint: "The REST API and its endpoints",
    href: siteLinks.apiReference,
    group: "Docs",
    keywords: "rest openapi developer endpoints",
  },
  {
    label: "Guides",
    hint: "Step-by-step setups and migrations",
    href: "/guides",
    group: "Site",
    keywords: "how to tutorial jira trello sso mcp",
  },
  {
    label: "Blog",
    hint: "Comparisons and notes from the team",
    href: "/blog",
    group: "Site",
    keywords: "posts articles alternatives",
  },
  {
    label: "Pricing",
    hint: "Margaya Cloud plans, and free self-hosting",
    href: siteLinks.pricing,
    group: "Site",
    keywords: "price cost plans cloud",
  },
  {
    label: "Comparisons",
    hint: "Margaya side by side with other tools",
    href: "/alternatives",
    group: "Site",
    keywords: "vs alternative jira linear asana trello",
  },
];

const shortcuts = [
  {
    icon: House,
    label: "Home",
    body: "Start from the top.",
    href: "/",
  },
  {
    icon: BookOpen,
    label: "Docs",
    body: "Set-up, features and the API.",
    href: siteLinks.docs,
  },
  {
    icon: LayoutGrid,
    label: "Features",
    body: "Planning, views, pages and more.",
    href: featurePath("plan"),
  },
];

export default function NotFound() {
  return (
    <>
      <Navbar />
      <main className="bg-[var(--background)] px-6 pt-16 pb-20 text-[var(--foreground)] md:pt-24 md:pb-28">
        <div className="mx-auto w-full max-w-2xl">
          <header className="flex flex-col items-center text-center">
            <p className="inline-flex items-center gap-2 rounded-full border border-border/80 px-3 py-1 font-mono text-muted-foreground text-xs">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-warning"
              />
              404 · No page at this address
            </p>
            <h1 className="mt-6 text-balance font-medium text-[2.5rem] leading-[1.08] tracking-[-0.03em] md:text-5xl">
              This link wandered off the board
            </h1>
            <p className="mt-5 max-w-xl text-pretty text-base text-muted-foreground leading-relaxed sm:text-lg">
              The page may have moved, or the address may have a typo. Tell us
              where you were heading and we'll point the way.
            </p>
          </header>

          <div className="mt-10">
            <NotFoundFinder links={links} />
          </div>

          <ul className="mt-6 grid gap-3 sm:grid-cols-3">
            {shortcuts.map((item) => (
              <li key={item.href}>
                <a
                  className="group flex h-full items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-foreground/25 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                  href={item.href}
                >
                  <item.icon
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
                  />
                  <span className="text-sm">
                    <span className="block font-medium">{item.label}</span>
                    <span className="mt-0.5 block text-muted-foreground">
                      {item.body}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>

          <p className="mt-10 text-center text-muted-foreground text-sm">
            Followed a broken link from our site?{" "}
            <a
              className="text-foreground underline decoration-border underline-offset-4 hover:decoration-current"
              href="mailto:support@margaya.app"
            >
              Let us know
            </a>{" "}
            and we'll fix it.
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}
