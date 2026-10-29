import type { Cell, CompareArea, FeatureKey } from "./types";

export const compareAreas: { id: CompareArea; title: string }[] = [
  { id: "planning", title: "Planning" },
  { id: "views", title: "Views" },
  { id: "docs", title: "Docs" },
  { id: "intake", title: "Intake & triage" },
  { id: "automation", title: "Automation & API" },
  { id: "self-hosting", title: "Self-hosting & data" },
  { id: "pricing", title: "Pricing" },
];

type Feature = { area: CompareArea; label: string; margaya: Cell };

/**
 * The rows every comparison table shows, with Margaya's side. Keep each note
 * true of the current product; the docs under `apps/docs/core` are the check.
 */
export const compareFeatures: Record<FeatureKey, Feature> = {
  cycles: {
    area: "planning",
    label: "Sprints or cycles",
    margaya: ["yes", "Burndown, burn-up and carryover"],
  },
  modules: {
    area: "planning",
    label: "Epics, modules or milestones",
    margaya: ["yes", "Modules with a lead and progress"],
  },
  estimates: {
    area: "planning",
    label: "Estimates",
    margaya: ["yes", "Points, categories or time"],
  },
  customFields: {
    area: "planning",
    label: "Custom fields",
    margaya: ["yes", "Text, number, date, dropdown, checkbox"],
  },
  timeTracking: {
    area: "planning",
    label: "Time tracking",
    margaya: ["yes", "Time entries on every task"],
  },
  relations: {
    area: "planning",
    label: "Sub-tasks and dependencies",
    margaya: ["yes", "Blocks, relates, duplicates, starts before"],
  },
  board: {
    area: "views",
    label: "Kanban board",
    margaya: ["yes", "Capture bar adds tasks in place"],
  },
  list: {
    area: "views",
    label: "List and spreadsheet",
    margaya: ["yes", "Spreadsheet edits fields inline"],
  },
  calendar: {
    area: "views",
    label: "Calendar",
    margaya: "yes",
  },
  gantt: {
    area: "views",
    label: "Gantt timeline",
    margaya: ["yes", "Dependency lines flag date conflicts"],
  },
  savedViews: {
    area: "views",
    label: "Saved views",
    margaya: ["yes", "Private or shared with the team"],
  },
  pages: {
    area: "docs",
    label: "Docs next to tasks",
    margaya: ["yes", "A page tree in every project"],
  },
  coEditing: {
    area: "docs",
    label: "Live co-editing",
    margaya: ["yes", "Live cursors and version history"],
  },
  intake: {
    area: "intake",
    label: "Request intake queue",
    margaya: ["yes", "Accept, decline, snooze or mark duplicate"],
  },
  inbox: {
    area: "intake",
    label: "Inbox and digests",
    margaya: ["yes", "Daily or weekly email digests"],
  },
  publicBoards: {
    area: "intake",
    label: "Public boards",
    margaya: ["yes", "Visitors can vote, comment and send requests"],
  },
  automations: {
    area: "automation",
    label: "Built-in automation",
    margaya: ["yes", "When, If, Then rules, scheduled cleanup and Git rules"],
  },
  api: {
    area: "automation",
    label: "REST API and webhooks",
    margaya: ["yes", "OpenAPI spec, signed webhooks"],
  },
  aiAssistant: {
    area: "automation",
    label: "Built-in AI assistant",
    margaya: ["yes", "Off by default; Claude or a model you host"],
  },
  mcp: {
    area: "automation",
    label: "MCP for AI assistants",
    margaya: ["yes", "Built into every instance"],
  },
  integrations: {
    area: "automation",
    label: "Code and chat integrations",
    margaya: ["yes", "GitHub, Gitea, Slack, Discord, Telegram, Mattermost"],
  },
  openSource: {
    area: "self-hosting",
    label: "Open source",
    margaya: ["yes", "MIT"],
  },
  selfHost: {
    area: "self-hosting",
    label: "Self-hosting",
    margaya: ["yes", "Docker or Helm, one app plus PostgreSQL"],
  },
  sso: {
    area: "self-hosting",
    label: "Single sign-on",
    margaya: ["yes", "Any OIDC provider, every edition"],
  },
  auditLog: {
    area: "self-hosting",
    label: "Audit log",
    margaya: ["yes", "Filterable, exports to CSV"],
  },
  freeSelfHost: {
    area: "pricing",
    label: "Free to self-host",
    margaya: ["yes", "No user or feature limits"],
  },
  managedCloud: {
    area: "pricing",
    label: "Managed cloud",
    margaya: ["yes", "Margaya Cloud, hosted in the EU"],
  },
  allFeatures: {
    area: "pricing",
    label: "No paid-only features",
    margaya: ["yes", "Self-hosted includes everything, SSO too"],
  },
};

export const MARGAYA_GLANCE = {
  hosting: "Self-host with Docker or Helm, or use Margaya Cloud",
  licence: "MIT, open source",
  pricing: "Free to self-host; Cloud is a subscription",
} as const;

export function cellMark(cell: Cell) {
  return typeof cell === "string" ? cell : cell[0];
}

export function cellNote(cell: Cell) {
  return typeof cell === "string" ? undefined : cell[1];
}
