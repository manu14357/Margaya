import { ArrowLeft, ArrowRight, ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import { Footer } from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { renderDocMarkdown } from "@/lib/docs/markdown";
import { findOperation } from "@/lib/docs/openapi";
import {
  type DocPage,
  getDocNeighbours,
  getDocPageBody,
  getDocsTabs,
  type NavTab,
  resolveDocLink,
} from "@/lib/docs/source";
import {
  MethodBadge,
  OperationEndpoint,
  OperationReference,
  operationHeadings,
} from "./api-operation";
import { DocsSearch } from "./docs-search";
import { DocsSidebarToggle } from "./docs-sidebar-toggle";

const SIDEBAR_ID = "docs-sidebar";
const EDIT_BASE = "https://github.com/manu14357/Margaya/blob/main/apps/docs";

export function docMetadata(page: DocPage): Metadata {
  const operation = page.openapi
    ? findOperation(page.openapi.method, page.openapi.path)
    : null;
  const title = operation?.summary ? operation.summary : page.title;
  const description =
    page.description ||
    `${title} in the Margaya documentation: guides and API reference for the open-source project management platform.`;
  return {
    title,
    description,
    alternates: { canonical: page.href },
    openGraph: {
      type: "article",
      siteName: "Margaya",
      title: `${title} | Margaya Docs`,
      description,
      url: page.href,
      images: [
        { url: "/og-image.png", width: 1200, height: 630, alt: "Margaya" },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} | Margaya Docs`,
      description,
      images: ["/og-image.png"],
    },
  };
}

// Tabs with more groups than this (the API reference) list only the current
// group's pages; the other groups link to their first page. Every page
// carries its sidebar, so listing all ~280 endpoints would dominate its size.
const EXPANDED_GROUP_LIMIT = 12;

function Sidebar({ tab, page }: { tab: NavTab; page: DocPage }) {
  const compact = tab.groups.length > EXPANDED_GROUP_LIMIT;
  return (
    <aside
      id={SIDEBAR_ID}
      aria-label="Documentation"
      className="docs-sidebar shrink-0 border-r lg:w-72"
    >
      <nav
        aria-label={`${tab.tab} pages`}
        className={`docs-sidebar-scroll${compact ? " docs-sidebar-compact" : ""}`}
      >
        {tab.groups.map((group) => {
          const current = group.items.some((item) => item.id === page.id);
          if (compact && !current) {
            return (
              <a
                key={group.group}
                href={group.items[0]?.href ?? tab.href}
                className="docs-nav-group-link"
              >
                {group.group}
              </a>
            );
          }
          return (
            <div key={group.group} className="docs-nav-group">
              <p className="docs-nav-heading">{group.group}</p>
              <ul className="docs-nav-list">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <a
                      href={item.href}
                      aria-current={item.id === page.id ? "page" : undefined}
                      className="docs-nav-link"
                    >
                      {item.method ? (
                        <MethodBadge method={item.method} small />
                      ) : null}
                      <span>{item.label}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

export function DocsPageView({ page }: { page: DocPage }) {
  const tabs = getDocsTabs();
  const tab = tabs.find((entry) => entry.tab === page.tab) ?? tabs[0];
  const operation = page.openapi
    ? findOperation(page.openapi.method, page.openapi.path)
    : null;
  const sections = operation ? operationHeadings(operation) : [];
  const resolveHref = (href: string) => resolveDocLink(page.id, href);
  const body = renderDocMarkdown(getDocPageBody(page), {
    resolveHref,
    reservedIds: sections.map((section) => section.id),
  });
  const intro = operation?.description
    ? renderDocMarkdown(operation.description, { resolveHref }).html
    : "";
  const outline = [...body.headings, ...sections];
  const { previous, next } = getDocNeighbours(page);

  return (
    <>
      <Navbar />
      <div className="border-b bg-background">
        <div className="mx-auto flex w-full max-w-[90rem] flex-wrap items-center gap-3 px-4 py-2.5 md:px-6">
          <DocsSidebarToggle controls={SIDEBAR_ID} />
          <nav aria-label="Documentation sections" className="flex gap-1">
            {tabs.map((entry) => (
              <a
                key={entry.tab}
                href={entry.href}
                aria-current={entry.tab === tab?.tab ? "true" : undefined}
                className="docs-tab"
              >
                {entry.tab}
              </a>
            ))}
          </nav>
          <div className="ml-auto w-full sm:w-auto">
            <DocsSearch />
          </div>
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-[90rem] max-lg:flex-col">
        {tab ? <Sidebar tab={tab} page={page} /> : null}
        <main className="min-w-0 flex-1 px-4 py-10 md:px-10 lg:py-12">
          <article className="mx-auto max-w-3xl">
            <header>
              {page.group ? (
                <p className="font-medium text-muted-foreground text-sm">
                  {page.group}
                </p>
              ) : null}
              <h1 className="mt-2 text-balance font-semibold text-3xl tracking-tight md:text-4xl">
                {page.title}
              </h1>
              {page.description ? (
                <p className="mt-3 text-lg text-muted-foreground leading-relaxed">
                  {page.description}
                </p>
              ) : null}
            </header>
            {operation ? <OperationEndpoint operation={operation} /> : null}
            {intro ? (
              <div
                className="docs-prose mt-6"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: rendered at build time from the committed OpenAPI document.
                dangerouslySetInnerHTML={{ __html: intro }}
              />
            ) : null}
            <div
              className="docs-prose mt-8"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: docs pages are trusted MDX files in this repository, rendered to HTML at build time.
              dangerouslySetInnerHTML={{ __html: body.html }}
            />
            {operation ? <OperationReference operation={operation} /> : null}
            <p className="mt-12 text-sm">
              <a
                href={`${EDIT_BASE}/${page.id}.mdx`}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                Edit this page on GitHub
                <ArrowUpRight aria-hidden="true" className="size-3.5" />
              </a>
            </p>
          </article>
          {previous || next ? (
            <nav
              aria-label="Previous and next pages"
              className="mx-auto mt-8 grid max-w-3xl gap-3 border-t pt-8 sm:grid-cols-2"
            >
              {previous ? (
                <a href={previous.href} className="docs-pager-link">
                  <span className="flex items-center gap-1 text-muted-foreground text-xs">
                    <ArrowLeft aria-hidden="true" className="size-3.5" />
                    Previous
                  </span>
                  <span className="font-medium">{previous.label}</span>
                </a>
              ) : (
                <span />
              )}
              {next ? (
                <a
                  href={next.href}
                  className="docs-pager-link sm:items-end sm:text-right"
                >
                  <span className="flex items-center gap-1 text-muted-foreground text-xs">
                    Next
                    <ArrowRight aria-hidden="true" className="size-3.5" />
                  </span>
                  <span className="font-medium">{next.label}</span>
                </a>
              ) : null}
            </nav>
          ) : null}
        </main>
        {outline.length > 1 ? (
          <aside
            aria-label="On this page"
            className="docs-toc shrink-0 max-xl:hidden xl:w-60"
          >
            <p className="font-medium text-sm">On this page</p>
            <ul className="mt-3 space-y-2 text-sm">
              {outline.map((heading) => (
                <li
                  key={heading.id}
                  className={heading.depth === 3 ? "pl-3" : undefined}
                >
                  <a
                    href={`#${heading.id}`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {heading.text}
                  </a>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}
      </div>
      <Footer />
    </>
  );
}
