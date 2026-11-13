import { isDesktopApp } from "@/lib/desktop";

// Pure helpers for product feedback: the coarse page type sent as context,
// the rating scales, and when a survey may appear without getting in the way.

export type FeedbackFormat = "faces3" | "faces5" | "stars" | "nps" | "thumbs";
export type SurveyFormat = Exclude<FeedbackFormat, "thumbs">;

export const FEEDBACK_PAGE_TYPES = [
  "home",
  "inbox",
  "my-work",
  "board",
  "list",
  "timeline",
  "calendar",
  "task",
  "cycles",
  "modules",
  "views",
  "intake",
  "pages",
  "analytics",
  "settings",
  "other",
] as const;
export type FeedbackPageType = (typeof FEEDBACK_PAGE_TYPES)[number];

/** Static i18n keys for each page type (shown in the dialog and to admins). */
export const PAGE_TYPE_KEYS: Record<FeedbackPageType, string> = {
  home: "settings:feedback.pageTypes.home",
  inbox: "settings:feedback.pageTypes.inbox",
  "my-work": "settings:feedback.pageTypes.myWork",
  board: "settings:feedback.pageTypes.board",
  list: "settings:feedback.pageTypes.list",
  timeline: "settings:feedback.pageTypes.timeline",
  calendar: "settings:feedback.pageTypes.calendar",
  task: "settings:feedback.pageTypes.task",
  cycles: "settings:feedback.pageTypes.cycles",
  modules: "settings:feedback.pageTypes.modules",
  views: "settings:feedback.pageTypes.views",
  intake: "settings:feedback.pageTypes.intake",
  pages: "settings:feedback.pageTypes.pages",
  analytics: "settings:feedback.pageTypes.analytics",
  settings: "settings:feedback.pageTypes.settings",
  other: "settings:feedback.pageTypes.other",
};

const PROJECT_SEGMENTS: Record<string, FeedbackPageType> = {
  board: "board",
  backlog: "list",
  spreadsheet: "list",
  gantt: "timeline",
  calendar: "calendar",
  task: "task",
  cycles: "cycles",
  modules: "modules",
  views: "views",
  intake: "intake",
  pages: "pages",
  analytics: "analytics",
};

const WORKSPACE_SEGMENTS: Record<string, FeedbackPageType> = {
  inbox: "inbox",
  "my-work": "my-work",
  task: "task",
  views: "views",
  analytics: "analytics",
};

/**
 * The kind of page a pathname shows. Only the type leaves the browser: no
 * ids, names or URLs.
 */
export function feedbackPageType(pathname: string): FeedbackPageType {
  if (pathname.startsWith("/dashboard/settings")) return "settings";
  const project = pathname.match(
    /^\/dashboard\/workspace\/[^/]+\/project\/[^/]+(?:\/([^/]+))?/,
  );
  if (project) {
    return project[1] ? (PROJECT_SEGMENTS[project[1]] ?? "other") : "board";
  }
  const workspace = pathname.match(
    /^\/dashboard\/workspace\/[^/]+(?:\/([^/]+))?/,
  );
  if (workspace) {
    return workspace[1]
      ? (WORKSPACE_SEGMENTS[workspace[1]] ?? "other")
      : "home";
  }
  if (pathname === "/dashboard" || pathname === "/dashboard/") return "home";
  return "other";
}

export function feedbackClient(): "web" | "desktop" {
  return isDesktopApp() ? "desktop" : "web";
}

export type ScaleOption = { score: number; labelKey: string };

/** Every choice of a scale, lowest first, with its spoken label. */
export function scaleOptions(format: FeedbackFormat): ScaleOption[] {
  switch (format) {
    case "faces3":
      return [
        { score: 1, labelKey: "settings:feedback.scale.unhappy" },
        { score: 2, labelKey: "settings:feedback.scale.neutral" },
        { score: 3, labelKey: "settings:feedback.scale.happy" },
      ];
    case "faces5":
      return [
        { score: 1, labelKey: "settings:feedback.scale.veryUnhappy" },
        { score: 2, labelKey: "settings:feedback.scale.unhappy" },
        { score: 3, labelKey: "settings:feedback.scale.neutral" },
        { score: 4, labelKey: "settings:feedback.scale.happy" },
        { score: 5, labelKey: "settings:feedback.scale.veryHappy" },
      ];
    case "stars":
      return [1, 2, 3, 4, 5].map((score) => ({
        score,
        labelKey: "settings:feedback.scale.stars",
      }));
    case "nps":
      return Array.from({ length: 11 }, (_, score) => ({
        score,
        labelKey: "settings:feedback.scale.npsScore",
      }));
    case "thumbs":
      return [
        { score: 0, labelKey: "settings:feedback.scale.thumbsDown" },
        { score: 1, labelKey: "settings:feedback.scale.thumbsUp" },
      ];
  }
}

const EDITABLE =
  "input, textarea, select, [contenteditable=''], [contenteditable='true']";
const OVERLAY =
  "[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'][data-open], [data-slot='sheet-popup']";

/**
 * A quiet moment: nothing is being typed and no dialog, sheet or menu is
 * open. The survey card only appears then, so it never interrupts a task.
 */
export function isQuietMoment(doc: Document = document): boolean {
  if (doc.visibilityState === "hidden") return false;
  const active = doc.activeElement;
  if (active && active !== doc.body && active.matches(EDITABLE)) return false;
  if (doc.querySelector(OVERLAY)) return false;
  return true;
}

/** Paths where the survey never shows: onboarding and invitations. */
export function isSurveyQuietPath(pathname: string): boolean {
  return (
    pathname.startsWith("/onboarding") ||
    pathname.startsWith("/invitations") ||
    pathname.startsWith("/dashboard/invitations")
  );
}
