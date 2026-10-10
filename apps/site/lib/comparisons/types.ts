/** How well a tool covers a row of the comparison table. */
export type Mark = "yes" | "partial" | "no";

/** A table cell: a mark, or a mark with a short note that qualifies it. */
export type Cell = Mark | readonly [Mark, string];

export type ComparisonCategory =
  | "issue-tracker"
  | "kanban"
  | "all-in-one"
  | "open-source";

export type CompareArea =
  | "planning"
  | "views"
  | "docs"
  | "intake"
  | "automation"
  | "self-hosting"
  | "pricing";

/** Every row of the comparison table; each competitor answers all of them. */
export type FeatureKey =
  | "cycles"
  | "modules"
  | "estimates"
  | "customFields"
  | "timeTracking"
  | "relations"
  | "board"
  | "list"
  | "calendar"
  | "gantt"
  | "savedViews"
  | "pages"
  | "coEditing"
  | "intake"
  | "inbox"
  | "publicBoards"
  | "automations"
  | "api"
  | "mcp"
  | "integrations"
  | "openSource"
  | "selfHost"
  | "sso"
  | "auditLog"
  | "freeSelfHost"
  | "managedCloud"
  | "allFeatures";

/** Product screenshots published under `/images/product/<view>-<theme>.png`. */
export type ProductView =
  | "board"
  | "list"
  | "spreadsheet"
  | "calendar"
  | "gantt"
  | "task"
  | "page"
  | "cycles"
  | "analytics"
  | "inbox"
  | "home";

export type Point = { title: string; body: string };

export type Comparison = {
  slug: string;
  competitor: string;
  categories: ComparisonCategory[];
  /** `<title>` and the card heading on listing pages. */
  title: string;
  /** Meta description, 140-160 characters. */
  description: string;
  /** One line for listing pages and llms.txt. */
  summary: string;
  /** The one-line answer shown under the hero heading. */
  verdict: string;
  glance: {
    hosting: string;
    licence: string;
    pricing: string;
    bestFor: string;
    /** Who Margaya suits better in this particular match-up. */
    margayaBestFor: string;
  };
  them: Record<FeatureKey, Cell>;
  shines: Point[];
  different: Point[];
  /** Competitor-specific lead-in for the migration section. */
  migration: string;
  faq: { question: string; answer: string }[];
  related: string[];
  screenshot: ProductView;
  /** When the competitor facts on the page were last reviewed (YYYY-MM-DD). */
  reviewedOn: string;
};

export function alternativePath(slug: string) {
  return `/${slug}-alternative`;
}
