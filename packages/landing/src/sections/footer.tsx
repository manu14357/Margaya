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
 * The public footer, in three bands: a quiet mission strip, with no buttons
 * because most pages end with their own call to action just above it; the
 * link columns (Product, Compare, Resources, Company); and a bottom bar with
 * the copyright, the self-hosting note and compact language and theme
 * controls (when the host provides `LandingPrefs`). Site-only pages
 * come from `links.site`; a link the host does not give is left out, and a
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
    <footer className="border-border border-t bg-sidebar">
      <div className="px-4 pt-14 pb-12 md:px-6 md:pt-16">
        <div className="mx-auto grid w-full max-w-6xl gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-12">
          <LandingLink
            href={links.home}
            aria-label={nav.home}
            className={cn("inline-flex self-start rounded-sm", FOCUS)}
          >
            <LandingLogo />
          </LandingLink>
          <div>
            <p className="max-w-2xl text-balance font-medium text-2xl text-foreground leading-snug tracking-tight md:text-3xl">
              {footer.mission}
            </p>
            <p className="mt-3 max-w-xl text-balance text-muted-foreground leading-relaxed">
              {footer.missionNote}
            </p>
          </div>
        </div>
      </div>

      <div className="border-border border-t px-4 md:px-6">
        <nav
          aria-label={footer.label}
          className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-x-6 gap-y-10 py-12 md:grid-cols-4 md:gap-x-0"
        >
          {visibleColumns.map((column, index) => (
            <div
              key={column.key}
              className="min-w-0 md:border-border md:border-l md:px-6 md:first:border-l-0 md:first:pl-0"
            >
              <h2 className="flex items-baseline gap-2 font-medium text-muted-foreground text-xs uppercase tracking-[0.08em]">
                <span aria-hidden className="font-mono text-foreground/40">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {column.title}
              </h2>
              <ul className="mt-4 flex flex-col gap-0.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <LandingLink
                      href={link.href ?? ""}
                      {...(link.external
                        ? { target: "_blank", rel: "noreferrer" }
                        : {})}
                      className={cn(
                        "group inline-flex min-h-8 items-center gap-1 rounded-sm text-foreground/80 text-sm transition-colors hover:text-foreground",
                        FOCUS,
                      )}
                    >
                      {link.label}
                      {link.external && (
                        <>
                          <ArrowUpRight
                            aria-hidden
                            className="size-3.5 text-muted-foreground transition-transform group-hover:-translate-y-px group-hover:translate-x-px motion-reduce:transition-none"
                          />
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

      <div className="border-border border-t px-4 md:px-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col-reverse gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
            <span suppressHydrationWarning>
              {fill(footer.copyright, { year: new Date().getFullYear() })}
            </span>
            <span aria-hidden className="text-foreground/20">
              /
            </span>
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
      </div>
    </footer>
  );
}
