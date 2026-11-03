import { ArrowLeft, ArrowRight, SquarePen } from "lucide-react";
import type { Metadata } from "next";
import { formatDocDate, getDocLastUpdated } from "@/lib/docs/last-updated";
import { renderDocMarkdown } from "@/lib/docs/markdown";
import { findOperation, operationHeadings } from "@/lib/docs/openapi";
import { docMarkdownHref } from "@/lib/docs/page-markdown";
import {
  type DocPage,
  getDocNeighbours,
  getDocPageBody,
  getDocsTabs,
  resolveDocLink,
} from "@/lib/docs/source";
import { siteLinks } from "@/lib/site-links";
import {
  OperationEndpoint,
  OperationExamples,
  OperationReference,
} from "./api-operation";
import { DocsCopyPage } from "./docs-copy-page";
import { DocsEnhance } from "./docs-enhance";
import { DocsHeader } from "./docs-header";
import { DocsMobileBar } from "./docs-mobile-bar";
import { DocsSidebarNav } from "./docs-sidebar";
import { DocsToc } from "./docs-toc";

const EDIT_BASE = "https://github.com/manu14357/Margaya/blob/main/apps/docs";

// Marks the document before the body paints, so tabbed blocks show one panel
// at a time from the first frame when scripts run (and stay stacked when not).
const JS_FLAG = "document.documentElement.setAttribute('data-docs-js','')";

export function docMetadata(page: DocPage): Metadata {
  const operation = page.openapi
    ? findOperation(page.openapi.method, page.openapi.path)
    : null;
  const title = operation?.summary ? operation.summary : page.title;
  const fullTitle = `${title} | Margaya Docs`;
  const description =
    page.description ||
    `${title} in the Margaya documentation: guides and API reference for the open-source project management platform.`;
  return {
    // Absolute, because the docs layout's title template does not apply to
    // the /docs index, which lives in the same route segment.
    title: { absolute: fullTitle },
    description,
    alternates: { canonical: page.href },
    openGraph: {
      type: "article",
      siteName: "Margaya",
      title: fullTitle,
      description,
      url: page.href,
      images: [
        { url: "/og-image.png", width: 1200, height: 630, alt: "Margaya" },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: ["/og-image.png"],
    },
  };
}

function DocsFooter() {
  return (
    <footer className="docs-footer">
      <span>© {new Date().getFullYear()} Margaya</span>
      <span aria-hidden="true">·</span>
      <a href="/">Home</a>
      <span aria-hidden="true">·</span>
      <a
        href={
          siteLinks.site?.license ?? `${siteLinks.github}/blob/main/LICENSE`
        }
        target="_blank"
        rel="noreferrer"
      >
        AGPL-3.0 licence
      </a>
      <span aria-hidden="true">·</span>
      <a href="/docs/platform/licensing">Licensing</a>
      <span aria-hidden="true">·</span>
      <a href={siteLinks.github} target="_blank" rel="noreferrer">
        GitHub
      </a>
    </footer>
  );
}

function Html({ html, className }: { html: string; className: string }) {
  return (
    <div
      className={className}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: docs pages are trusted MDX files in this repository (and the committed OpenAPI document), rendered to HTML at build time.
      dangerouslySetInnerHTML={{ __html: html }}
    />
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
    source: page.id,
  });
  const intro = operation?.description
    ? renderDocMarkdown(operation.description, {
        resolveHref,
        source: page.id,
      }).html
    : "";
  const outline = [...body.headings, ...sections];
  const landing = page.mode === "landing";
  const showToc = !operation && !landing && outline.length > 1;
  const lastUpdated = getDocLastUpdated(page.id);
  const { previous, next } = getDocNeighbours(page);
  const eyebrow = [page.tab, page.group].filter(Boolean).join(" › ");
  const sidebar = tab ? <DocsSidebarNav tab={tab} page={page} /> : null;
  const width = operation
    ? "docs-main-wide"
    : landing
      ? "docs-main-landing"
      : "";

  return (
    <>
      <script
        // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant one-line flag, set before the content paints.
        dangerouslySetInnerHTML={{ __html: JS_FLAG }}
      />
      <DocsHeader
        tabs={tabs.map((entry) => ({
          tab: entry.tab,
          href: entry.href,
          active: entry.tab === tab?.tab,
        }))}
      />
      <div className="docs-layout">
        {sidebar ? (
          <aside className="docs-sidebar" data-docs-sidebar>
            <div className="docs-sidebar-scroll" data-docs-scroll>
              {sidebar}
            </div>
          </aside>
        ) : null}
        <div className="docs-column">
          <DocsMobileBar headings={landing ? [] : outline}>
            {sidebar}
          </DocsMobileBar>
          <main id="docs-main" className={`docs-main ${width}`}>
            <article className="docs-article">
              <header className={landing ? "docs-hero" : "docs-page-header"}>
                <div className="docs-title-row">
                  <div className="min-w-0">
                    {eyebrow && !landing ? (
                      <p className="docs-eyebrow">{eyebrow}</p>
                    ) : null}
                    <h1 className="docs-title">
                      {operation?.summary || page.title}
                    </h1>
                  </div>
                  {landing ? null : (
                    <DocsCopyPage markdownHref={docMarkdownHref(page)} />
                  )}
                </div>
                {page.description ? (
                  <p className="docs-lead">{page.description}</p>
                ) : null}
                {operation ? (
                  <>
                    <OperationEndpoint operation={operation} />
                    <p className="docs-operation-id">
                      Operation ID <code>{operation.operationId}</code>
                    </p>
                  </>
                ) : null}
              </header>
              {operation ? (
                <div className="docs-api-grid">
                  <div className="docs-api-main">
                    {intro ? (
                      <Html className="docs-prose" html={intro} />
                    ) : null}
                    {body.html.trim() ? (
                      <Html className="docs-prose mt-6" html={body.html} />
                    ) : null}
                    <OperationReference operation={operation} />
                  </div>
                  <OperationExamples operation={operation} />
                </div>
              ) : (
                <Html
                  className={`docs-prose ${landing ? "mt-10" : "mt-8"}`}
                  html={body.html}
                />
              )}
              <div className="docs-edit-row">
                <a
                  href={`${EDIT_BASE}/${page.id}.mdx`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="docs-edit-link"
                >
                  <SquarePen aria-hidden="true" className="size-4" />
                  Edit this page
                  <span className="sr-only">
                    {" "}
                    on GitHub (opens in a new tab)
                  </span>
                </a>
                {lastUpdated ? (
                  <p className="docs-last-updated">
                    Last updated:{" "}
                    <time dateTime={lastUpdated}>
                      {formatDocDate(lastUpdated)}
                    </time>
                  </p>
                ) : null}
              </div>
            </article>
            {previous || next ? (
              <nav aria-label="Previous and next pages" className="docs-pager">
                {previous ? (
                  <a href={previous.href} className="docs-pager-link">
                    <span className="docs-pager-label">
                      <ArrowLeft aria-hidden="true" className="size-3.5" />
                      Previous page
                    </span>
                    <span className="docs-pager-title">{previous.label}</span>
                  </a>
                ) : (
                  <span className="max-sm:hidden" />
                )}
                {next ? (
                  <a
                    href={next.href}
                    className="docs-pager-link sm:items-end sm:text-right"
                  >
                    <span className="docs-pager-label">
                      Next page
                      <ArrowRight aria-hidden="true" className="size-3.5" />
                    </span>
                    <span className="docs-pager-title">{next.label}</span>
                  </a>
                ) : null}
              </nav>
            ) : null}
          </main>
          <DocsFooter />
        </div>
        {showToc ? (
          <div className="docs-toc">
            <DocsToc headings={outline} />
          </div>
        ) : null}
      </div>
      <DocsEnhance />
    </>
  );
}
