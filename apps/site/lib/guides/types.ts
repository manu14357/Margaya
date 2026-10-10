/** Views captured under /images/product/<view>-<theme>.png. */
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

export type GuideShot = {
  view: ProductView;
  alt: string;
  caption?: string;
};

export type GuideCallout = {
  tone: "tip" | "note" | "warning";
  title: string;
  body: string;
};

export type GuideCode = {
  /** Shown above the block, e.g. a file name or "Terminal". */
  label: string;
  content: string;
};

/** A comparison entry inside a section, e.g. one tool on a shortlist. */
export type GuideItem = {
  name: string;
  body: string;
  href?: string;
  meta?: string;
};

/** One numbered step. Steps are numbered across the whole guide. */
export type GuideStep = {
  title: string;
  body: string[];
  bullets?: string[];
  code?: GuideCode;
  callout?: GuideCallout;
  shot?: GuideShot;
};

export type GuideSection = {
  heading: string;
  body?: string[];
  items?: GuideItem[];
  steps?: GuideStep[];
  callout?: GuideCallout;
  shot?: GuideShot;
};

export type GuideTopic = "start" | "plan" | "connect" | "self-host" | "choose";

export const guideTopics: { id: GuideTopic; label: string; blurb: string }[] = [
  {
    id: "start",
    label: "Get started",
    blurb: "Set up a workspace your team will actually keep using.",
  },
  {
    id: "plan",
    label: "Plan and track",
    blurb: "Boards, views and the habits that keep them tidy.",
  },
  {
    id: "connect",
    label: "Connect",
    blurb: "Bring AI agents and other tools into the work.",
  },
  {
    id: "self-host",
    label: "Run it yourself",
    blurb: "Servers, sign-in and where your data lives.",
  },
  {
    id: "choose",
    label: "Choose a tool",
    blurb: "Fair comparisons, and how to move your work across.",
  },
];

export type Guide = {
  slug: string;
  /** The literal question people ask, used as the H1. */
  question: string;
  title: string;
  description: string;
  summary: string;
  /** Two to four sentences that answer the question outright. */
  answer: string;
  topic: GuideTopic;
  /** Rough time to follow the guide end to end, e.g. "20 minutes". */
  timeNeeded: string;
  /** What to have ready before starting. */
  before?: string[];
  sections: GuideSection[];
  faq: { question: string; answer: string }[];
  next: { label: string; href: string; description: string }[];
  updatedOn: string;
};

export function guidePath(slug: string) {
  return `/guides/${slug}`;
}
