"use client";

import {
  type AnchorHTMLAttributes,
  type ComponentType,
  createContext,
  type ReactNode,
  useContext,
} from "react";

/** Every href the landing renders. Each app passes its own URLs. */
export type LandingLinks = {
  /** The landing page itself (logo link). */
  home: string;
  /** Hosted sign-in. Optional: without one the navbar shows no Sign in button. */
  signIn?: string;
  signUp: string;
  /** The self-hosting install guide. */
  selfHost: string;
  docs: string;
  apiReference: string;
  github: string;
  /** The feature pages on the public site. */
  features: {
    plan: string;
    views: string;
    ai: string;
    docs: string;
    automate: string;
    selfHost: string;
  };
  /**
   * Public-website pages the navbar and footer list (guides, press, legal,
   * licensing).
   * Optional: a link that is not given is left out.
   */
  site?: Partial<Record<LandingSiteLink, string>>;
};

export type LandingSiteLink =
  | "changelog"
  | "roadmap"
  | "guides"
  | "press"
  | "privacy"
  | "terms"
  | "license"
  | "commercial";

export type LandingLinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
> & { href: string };

/** An app's router link, e.g. one that maps `href` to TanStack's `to`. */
export type LandingLinkComponent = ComponentType<LandingLinkProps>;

type LinksContextValue = {
  links: LandingLinks;
  Link?: LandingLinkComponent;
};

const LandingLinksContext = createContext<LinksContextValue | null>(null);

export function LandingLinksProvider({
  links,
  linkComponent,
  children,
}: {
  links: LandingLinks;
  /** Used for same-origin hrefs (starting with "/"); others use `<a>`. */
  linkComponent?: LandingLinkComponent;
  children: ReactNode;
}) {
  return (
    <LandingLinksContext.Provider value={{ links, Link: linkComponent }}>
      {children}
    </LandingLinksContext.Provider>
  );
}

/** The landing hrefs. Throws outside a `LandingLinksProvider`. */
export function useLandingLinks(): LandingLinks {
  const value = useContext(LandingLinksContext);
  if (!value) {
    throw new Error("useLandingLinks must be used inside LandingLinksProvider");
  }
  return value.links;
}

/**
 * A link that goes through the app's router for same-origin paths and is a
 * plain anchor for everything else (absolute URLs, `#hash`).
 */
export function LandingLink({ href, ...props }: LandingLinkProps) {
  const Link = useContext(LandingLinksContext)?.Link;
  if (Link && href.startsWith("/") && !href.startsWith("//")) {
    return <Link href={href} {...props} />;
  }
  return <a href={href} {...props} />;
}
