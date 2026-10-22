"use client";

import { ArrowUpRight, Server } from "lucide-react";
import { fill, useLandingCopy } from "../copy";
import { cn } from "../lib/cn";
import { LandingLogo } from "../lib/logo";
import { LandingLink, useLandingLinks } from "../links";
import { LandingLanguageSelect, LandingThemeSwitch } from "./prefs-controls";

type FooterLink = { label: string; href?: string; external?: boolean };

const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

/**
 * The public footer, in two bands: the logo with a short mission beside the
 * link columns (Product, Compare, Resources, Company), then a bottom bar
 * with the copyright, the self-hosting note and compact language and theme
 * controls (when the host provides `LandingPrefs`). Site-only pages come
 * from `links.site`; a link the host does not give is left out, and a
 * column with no links is dropped.
 */
export function LandingFooter() {
  const landing = useLandingCopy();
  const footer = landing.home.footer;
  const nav = landing.home.nav;
  const links = useLandingLinks();
  const site = links.site ?? {};

  const columns: { key: string; title: string; links: FooterLink[] }[] = [
    {
      key: "product",
      title: footer.product.title,
      links: [
        { label: nav.items.plan.title, href: links.features.plan },
        { label: nav.items.views.title, href: links.features.views },
        { label: nav.items.ai.title, href: links.features.ai },
        { label: nav.items.docs.title, href: links.features.docs },
        { label: nav.items.automate.title, href: links.features.automate },
        { label: nav.items.selfHost.title, href: links.features.selfHost },
        { label: footer.product.pricing, href: links.pricing },
        {
          label: footer.product.changelog,
          href: site.changelog,
          external: true,
        },
        { label: footer.product.roadmap, href: site.roadmap, external: true },
      ],
    },
    {
      key: "compare",
      title: footer.compare.title,
      links: [
        { label: footer.compare.jira, href: site.compareJira },
        { label: footer.compare.trello, href: site.compareTrello },
        { label: footer.compare.linear, href: site.compareLinear },
        { label: footer.compare.asana, href: site.compareAsana },
        { label: footer.compare.clickup, href: site.compareClickup },
        { label: footer.compare.monday, href: site.compareMonday },
        { label: footer.compare.all, href: site.alternatives },
      ],
    },
    {
      key: "resources",
      title: footer.resources.title,
      links: [
        { label: footer.resources.docs, href: links.docs },
        { label: footer.resources.api, href: links.apiReference },
        { label: footer.resources.guides, href: site.guides },
        { label: footer.resources.blog, href: site.blog },
        { label: footer.resources.press, href: site.press },
      ],
    },
    {
      key: "company",
      title: footer.company.title,
      links: [
        { label: footer.company.privacy, href: site.privacy },
        { label: footer.company.terms, href: site.terms },
        { label: footer.company.licence, href: site.license, external: true },
        { label: footer.company.github, href: links.github, external: true },
      ],
    },
  ];

  const visibleColumns = columns
    .map((column) => ({
      ...column,
      links: column.links.filter((link) => link.href),
    }))
    .filter((column) => column.links.length > 0);

  return (
    <footer className="border-border border-t px-4 sm:px-6">
      <div className="mx-auto grid w-full max-w-6xl gap-10 py-14 md:grid-cols-[minmax(0,2fr)_minmax(0,5fr)] md:gap-12 md:py-16">
        <div className="flex flex-col items-start">
          <LandingLink
            href={links.home}
            aria-label={nav.home}
            className={cn("inline-flex rounded-sm", FOCUS)}
          >
            <LandingLogo />
          </LandingLink>
          <p className="mt-5 max-w-xs text-pretty text-foreground text-sm leading-relaxed">
            {footer.mission}
          </p>
          <p className="mt-2 max-w-xs text-pretty text-muted-foreground text-sm leading-relaxed">
            {footer.missionNote}
          </p>
        </div>

        <nav
          aria-label={footer.label}
          className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4"
        >
          {visibleColumns.map((column) => (
            <div key={column.key} className="min-w-0">
              <h2 className="font-medium text-foreground text-sm">
                {column.title}
              </h2>
              <ul className="mt-3 flex flex-col gap-0.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <LandingLink
                      href={link.href ?? ""}
                      {...(link.external
                        ? { target: "_blank", rel: "noreferrer" }
                        : {})}
                      className={cn(
                        "inline-flex min-h-8 items-center gap-1 rounded-sm text-muted-foreground text-sm transition-colors hover:text-foreground",
                        FOCUS,
                      )}
                    >
                      {link.label}
                      {link.external && (
                        <>
                          <ArrowUpRight aria-hidden className="size-3.5" />
                          <span className="sr-only">{nav.newTab}</span>
                        </>
                      )}
                    </LandingLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      <div className="mx-auto flex w-full max-w-6xl flex-col-reverse gap-3 border-border border-t py-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
          <span suppressHydrationWarning>
            {fill(footer.copyright, { year: new Date().getFullYear() })}
          </span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1.5">
            <Server aria-hidden className="size-3.5" />
            {footer.selfHosted}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <LandingLanguageSelect compact />
          <LandingThemeSwitch compact />
        </div>
      </div>
    </footer>
  );
}
