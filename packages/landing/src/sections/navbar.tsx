"use client";

import {
  ArrowUpRight,
  ChevronDown,
  FileText,
  LayoutGrid,
  type LucideIcon,
  Menu,
  Server,
  Sparkles,
  Target,
  Workflow,
  X,
} from "lucide-react";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { useLandingCopy } from "../copy";
import { LandingButton } from "../lib/button";
import { cn } from "../lib/cn";
import { LandingLogo } from "../lib/logo";
import { LandingLink, useLandingLinks } from "../links";
import { hasLanguageChoice, useLandingPrefs } from "../prefs";
import {
  LandingLanguageMenu,
  LandingLanguageSelect,
  LandingThemeMenu,
  LandingThemeSwitch,
} from "./prefs-controls";

type FeatureKey = "plan" | "views" | "ai" | "docs" | "automate" | "selfHost";

const FEATURES: { key: FeatureKey; icon: LucideIcon }[] = [
  { key: "plan", icon: Target },
  { key: "views", icon: LayoutGrid },
  { key: "ai", icon: Sparkles },
  { key: "docs", icon: FileText },
  { key: "automate", icon: Workflow },
  { key: "selfHost", icon: Server },
];

const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

const NAV_LINK = cn(
  "inline-flex h-8 items-center gap-1 rounded-md px-2.5 font-medium text-muted-foreground text-sm transition-colors hover:bg-accent hover:text-foreground",
  FOCUS,
);

/**
 * Closes a disclosure on Escape (returning focus to its button), on a press
 * outside `rootRef`, and when focus leaves it.
 */
function useDismiss(
  open: boolean,
  close: () => void,
  rootRef: RefObject<HTMLElement | null>,
  buttonRef: RefObject<HTMLButtonElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: Event) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      close();
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close, rootRef, buttonRef]);
}

/** The Features disclosure: five feature tours and a one-line intro. */
function FeaturesMenu() {
  const nav = useLandingCopy().home.nav;
  const links = useLandingLinks();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const closeRef = useRef(() => setOpen(false));
  useDismiss(open, closeRef.current, rootRef, buttonRef);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          NAV_LINK,
          "aria-expanded:bg-accent aria-expanded:text-foreground",
        )}
      >
        {nav.features}
        <ChevronDown
          aria-hidden
          className={cn(
            "size-3.5 transition-transform motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute top-full left-0 z-50 mt-3 w-[36rem] rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg/5"
      >
        <ul className="grid grid-cols-2 gap-1">
          {FEATURES.map(({ key, icon: Icon }) => (
            <li key={key}>
              <LandingLink
                href={links.features[key]}
                onClick={() => setOpen(false)}
                className={cn(
                  "group flex h-full items-start gap-3 rounded-lg p-3 transition-colors hover:bg-accent",
                  FOCUS,
                )}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors group-hover:text-foreground">
                  <Icon aria-hidden className="size-4" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium text-foreground text-sm">
                    {nav.items[key].title}
                  </span>
                  <span className="mt-0.5 text-muted-foreground text-xs leading-relaxed">
                    {nav.items[key].description}
                  </span>
                </span>
              </LandingLink>
            </li>
          ))}
          <li className="flex items-end p-3 text-muted-foreground text-xs leading-relaxed">
            {nav.featuresIntro}
          </li>
        </ul>
      </div>
    </div>
  );
}

type NavItem = { label: string; href?: string; external?: boolean };

/** The plain links after Features, in order; missing hrefs are left out. */
function useNavItems(): NavItem[] {
  const nav = useLandingCopy().home.nav;
  const links = useLandingLinks();
  return [
    { label: nav.docs, href: links.docs },
    { label: nav.download, href: links.site?.download },
  ].filter((item) => item.href);
}

function MobileMenu({
  id,
  open,
  onClose,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
}) {
  const copy = useLandingCopy().home;
  const nav = copy.nav;
  const prefs = useLandingPrefs();
  const links = useLandingLinks();
  const items = useNavItems();
  const rowLink = cn(
    "flex min-h-12 items-center justify-between rounded-md px-1 font-medium text-base",
    FOCUS,
  );

  return (
    <div
      id={id}
      hidden={!open}
      className="absolute inset-x-0 top-full z-50 max-h-[calc(100dvh-4rem)] overflow-y-auto border-border border-b bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-foreground shadow-lg/5 sm:px-6 lg:hidden"
    >
      <div className="mx-auto w-full max-w-6xl">
        <nav aria-label={nav.menu}>
          <p className="pt-4 pb-1 font-medium text-muted-foreground text-xs">
            {nav.features}
          </p>
          <ul className="grid gap-x-4 sm:grid-cols-2">
            {FEATURES.map(({ key, icon: Icon }) => (
              <li key={key}>
                <LandingLink
                  href={links.features[key]}
                  onClick={onClose}
                  className={cn(
                    "flex min-h-12 items-center gap-3 rounded-md px-1 text-sm",
                    FOCUS,
                  )}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
                    <Icon aria-hidden className="size-4" />
                  </span>
                  {nav.items[key].title}
                </LandingLink>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-border border-t pt-4 pb-1 font-medium text-muted-foreground text-xs">
            {nav.explore}
          </p>
          <ul>
            {items.map((item) => (
              <li key={item.label}>
                <LandingLink
                  href={item.href ?? ""}
                  onClick={onClose}
                  className={rowLink}
                >
                  {item.label}
                </LandingLink>
              </li>
            ))}
            <li>
              <LandingLink
                href={links.github}
                onClick={onClose}
                target="_blank"
                rel="noreferrer"
                className={rowLink}
              >
                <span>
                  {nav.github}
                  <span className="sr-only"> {nav.newTab}</span>
                </span>
                <ArrowUpRight
                  aria-hidden
                  className="size-4 text-muted-foreground"
                />
              </LandingLink>
            </li>
          </ul>
        </nav>
        {prefs && (
          <section
            aria-label={copy.prefs.label}
            className="mt-3 flex flex-col gap-4 border-border border-t pt-4"
          >
            {hasLanguageChoice(prefs) && <LandingLanguageSelect />}
            <LandingThemeSwitch />
          </section>
        )}
        <div
          className={`mt-4 grid gap-3 border-border border-t pt-4 ${links.signIn ? "grid-cols-2" : "grid-cols-1"}`}
        >
          {links.signIn && (
            <LandingButton
              href={links.signIn}
              variant="outline"
              size="md"
              className="h-11"
            >
              {nav.signIn}
            </LandingButton>
          )}
          <LandingButton href={links.signUp} size="md" className="h-11">
            {nav.getStarted}
          </LandingButton>
        </div>
      </div>
    </div>
  );
}

/**
 * The public navbar: a plain full-width bar with a hairline border, the logo; Features (a menu of the
 * five feature pages) and Docs; then the language
 * and theme menus (when the host provides `LandingPrefs`), GitHub, Sign in
 * and Get started. Below `lg` everything but Get started folds into a panel
 * under the bar, full width. The header stays 4rem tall: the docs layout's sticky
 * sidebars sit at `top-16`.
 */
export function LandingNavbar() {
  const nav = useLandingCopy().home.nav;
  const links = useLandingLinks();
  const items = useNavItems();
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileId = useId();
  const barRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(() => setMobileOpen(false));
  useDismiss(mobileOpen, closeRef.current, barRef, toggleRef);

  useEffect(() => {
    if (!mobileOpen) return;
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMobileOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, [mobileOpen]);

  return (
    <header
      ref={barRef}
      className="sticky top-0 z-40 flex h-16 items-center border-border border-b bg-background/95 px-4 backdrop-blur-sm sm:px-6"
    >
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-6">
          <LandingLink
            href={links.home}
            aria-label={nav.home}
            className={cn("flex h-8 shrink-0 items-center rounded-sm", FOCUS)}
          >
            <LandingLogo />
          </LandingLink>
          <nav aria-label={nav.label} className="max-lg:hidden">
            <ul className="flex items-center gap-0.5">
              <li>
                <FeaturesMenu />
              </li>
              {items.map((item) => (
                <li key={item.label}>
                  <LandingLink href={item.href ?? ""} className={NAV_LINK}>
                    {item.label}
                  </LandingLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div className="flex items-center max-lg:hidden">
            <LandingLanguageMenu />
            <LandingThemeMenu />
            <span aria-hidden className="mx-1.5 h-5 w-px bg-border" />
            <LandingLink
              href={links.github}
              target="_blank"
              rel="noreferrer"
              className={NAV_LINK}
            >
              {nav.github}
              <ArrowUpRight aria-hidden className="size-3.5" />
              <span className="sr-only">{nav.newTab}</span>
            </LandingLink>
          </div>
          {links.signIn && (
            <LandingButton
              href={links.signIn}
              variant="ghost"
              size="md"
              className="max-lg:hidden"
            >
              {nav.signIn}
            </LandingButton>
          )}
          <LandingButton href={links.signUp} size="md">
            {nav.getStarted}
          </LandingButton>
          <button
            ref={toggleRef}
            type="button"
            aria-expanded={mobileOpen}
            aria-controls={mobileId}
            aria-label={mobileOpen ? nav.closeMenu : nav.openMenu}
            onClick={() => setMobileOpen((value) => !value)}
            className={cn(
              "inline-flex size-10 items-center justify-center rounded-lg text-foreground hover:bg-accent lg:hidden",
              FOCUS,
            )}
          >
            {mobileOpen ? (
              <X aria-hidden className="size-5" />
            ) : (
              <Menu aria-hidden className="size-5" />
            )}
          </button>
        </div>
      </div>
      <MobileMenu
        id={mobileId}
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />
    </header>
  );
}
