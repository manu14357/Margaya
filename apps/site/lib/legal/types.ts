/**
 * Inline text may hold `**bold**` and `[label](href)` links; nothing else is
 * parsed.
 */
export type LegalBlock =
  | { type: "p"; text: string }
  | { type: "list"; items: string[] };

export type LegalSection = {
  /** The in-page anchor. */
  id: string;
  title: string;
  blocks: LegalBlock[];
};

export type LegalDocument = {
  path: string;
  metaTitle: string;
  metaDescription: string;
  title: string;
  intro: string;
  /** ISO date (YYYY-MM-DD) of the last change to the text. */
  updated: string;
  summaryTitle: string;
  summary: string[];
  sections: LegalSection[];
};

export const GITHUB_URL = "https://github.com/manu14357/Margaya";

/** Where commercial-licence enquiries go. */
export const COMMERCIAL_EMAIL = "manoharchoppa6@gmail.com";

/** The words around every legal page. */
export const legalChrome = {
  eyebrow: "Legal",
  updated: "Last updated",
  onThisPage: "On this page",
  notice:
    "This page explains how this website and the Margaya software work; it isn't legal advice. If you run your own Margaya instance for other people, you are responsible for your own terms and privacy policy.",
  related: "Related",
};
