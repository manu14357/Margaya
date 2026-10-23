"use client";

import {
  LandingLogo,
  LandingThemeMenu,
  LandingThemeSwitch,
} from "@margaya/landing";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { useRef } from "react";
import { SiteLandingProviders } from "@/components/landing/site-landing";
import { siteLinks } from "@/lib/site-links";
import { DocsSearch } from "./docs-search";

export type DocsHeaderTab = { tab: string; href: string; active: boolean };

function GithubMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

/**
 * The docs-only header: logo and "Docs", the section links, search, theme,
 * GitHub and Get started. Narrow screens keep the logo, search and a menu.
 */
export function DocsHeader({ tabs }: { tabs: DocsHeaderTab[] }) {
  const menuRef = useRef<HTMLDialogElement>(null);

  return (
    <SiteLandingProviders>
      <header className="docs-header">
        <a href="#docs-main" className="docs-skip-link">
          Skip to content
        </a>
        <div className="docs-header-inner">
          <div className="flex min-w-0 items-center gap-2">
            <a
              href="/"
              aria-label="Margaya home"
              className="docs-focus flex h-8 shrink-0 items-center rounded-sm"
            >
              <LandingLogo />
            </a>
            <span aria-hidden="true" className="h-4 w-px bg-border" />
            <a
              href="/docs"
              className="docs-focus rounded-sm font-medium text-muted-foreground text-sm transition-colors hover:text-foreground"
            >
              Docs
            </a>
          </div>
          <nav aria-label="Documentation sections" className="docs-top-nav">
            {tabs.map((tab) => (
              <a
                key={tab.tab}
                href={tab.href}
                aria-current={tab.active ? "page" : undefined}
                className="docs-top-link"
              >
                {tab.tab}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <DocsSearch />
            <div className="flex items-center gap-1 max-lg:hidden">
              <LandingThemeMenu />
              <a
                href={siteLinks.github}
                target="_blank"
                rel="noreferrer"
                aria-label="Margaya on GitHub (opens in a new tab)"
                className="docs-icon-button"
              >
                <GithubMark className="size-4" />
              </a>
              <a href={siteLinks.signUp} className="docs-cta">
                Get started
              </a>
            </div>
            <button
              type="button"
              aria-label="Open site menu"
              aria-haspopup="dialog"
              onClick={() => menuRef.current?.showModal()}
              className="docs-icon-button lg:hidden"
            >
              <Menu aria-hidden="true" className="size-4" />
            </button>
          </div>
        </div>
        <dialog
          ref={menuRef}
          aria-label="Site menu"
          className="docs-sheet"
          onClick={(event) => {
            // A click on the dialog box itself is a click on the backdrop.
            if (event.target === event.currentTarget) menuRef.current?.close();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") menuRef.current?.close();
          }}
        >
          <div className="docs-sheet-panel">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">Documentation</span>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => menuRef.current?.close()}
                className="docs-icon-button"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>
            <nav aria-label="Documentation sections" className="mt-3 grid">
              {tabs.map((tab) => (
                <a
                  key={tab.tab}
                  href={tab.href}
                  aria-current={tab.active ? "page" : undefined}
                  className="docs-sheet-link"
                >
                  {tab.tab}
                </a>
              ))}
              <a href="/" className="docs-sheet-link">
                Margaya home
              </a>
            </nav>
            <LandingThemeSwitch className="mt-4" />
            <div className="mt-4 grid grid-cols-2 gap-2">
              <a
                href={siteLinks.github}
                target="_blank"
                rel="noreferrer"
                className="docs-sheet-button"
              >
                <GithubMark className="size-4" />
                GitHub
                <ArrowUpRight aria-hidden="true" className="size-3.5" />
              </a>
              <a href={siteLinks.signUp} className="docs-cta h-10">
                Get started
              </a>
            </div>
          </div>
        </dialog>
      </header>
    </SiteLandingProviders>
  );
}
