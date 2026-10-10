import type { Comparison } from "./types";

export const leantime: Comparison = {
  slug: "leantime",
  competitor: "Leantime",
  categories: ["all-in-one", "open-source"],
  title: "Margaya vs Leantime: an open-source Leantime alternative",
  description:
    "Compare Margaya and Leantime, two self-hosted project tools: Margaya is MIT licensed, with cycles, intake, live docs and every feature in the core.",
  summary:
    "Cycles, intake and live docs in an MIT-licensed tool with no paid plugins.",
  verdict:
    "Choose Leantime for strategy boards and a gentle, neurodivergent-friendly approach to planning; choose Margaya for a fast team tracker with every feature in the open-source core.",
  glance: {
    hosting: "Self-host, or Leantime's cloud",
    licence: "AGPLv3, plus paid plugins",
    pricing: "Free core; paid plugins and cloud plans",
    bestFor:
      "Small teams and non-project managers who want strategy and tasks together",
    margayaBestFor:
      "Teams that want a fast tracker with intake and live docs, all in the free core",
  },
  them: {
    cycles: ["yes", "Sprints"],
    modules: ["yes", "Milestones and goals"],
    estimates: ["yes", "Effort and hours"],
    customFields: ["partial", "Through plugins"],
    timeTracking: ["yes", "Timesheets"],
    relations: ["yes", "Subtasks and dependencies"],
    board: "yes",
    list: ["yes", "List and table"],
    calendar: "yes",
    gantt: ["yes", "Timeline"],
    savedViews: "partial",
    pages: ["yes", "Docs and wiki"],
    coEditing: ["partial", "Wiki pages"],
    intake: ["partial", "Idea boards"],
    inbox: "yes",
    publicBoards: "no",
    automations: "no",
    api: ["yes", "JSON-RPC API"],
    mcp: ["partial", "Through plugins"],
    integrations: ["partial", "Chat notifications and plugins"],
    openSource: ["yes", "AGPLv3"],
    selfHost: "yes",
    sso: ["yes", "LDAP and OIDC"],
    auditLog: ["partial", "Activity history"],
    freeSelfHost: "yes",
    managedCloud: "yes",
    allFeatures: ["no", "Paid plugins and cloud tiers"],
  },
  shines: [
    {
      title: "Strategy next to tasks",
      body: "Goals, idea boards, lean canvases and retrospectives give small teams a structure for why they work, not only what they work on.",
    },
    {
      title: "Designed for different minds",
      body: "Leantime is designed with ADHD, autism and dyslexia in mind, with a calm, guided interface for people who do not think in tickets.",
    },
    {
      title: "Timesheets built in",
      body: "Time tracking and timesheets are part of the core, useful for teams that bill or report hours.",
    },
  ],
  different: [
    {
      title: "Everything in the open core",
      body: "Margaya has no paid plugins. Custom fields, the audit log, single sign-on, analytics and integrations ship in the MIT-licensed code.",
    },
    {
      title: "Built for busy boards",
      body: "Live updates over WebSockets, a capture bar and keyboard navigation keep daily work fast when a board holds a lot of tasks.",
    },
    {
      title: "Intake and public boards",
      body: "Triage incoming requests before they reach the board, and publish a project so visitors can vote, comment and send requests.",
    },
  ],
  migration:
    "Get the Leantime tasks you want to keep into a CSV file, then import it into a Margaya project and map status, assignee, priority, dates and tags before you confirm.",
  faq: [
    {
      question: "Does Margaya have goals or strategy boards?",
      answer:
        "No. Margaya concentrates on execution: tasks, cycles, modules, intake and docs. Project pages can hold strategy notes, but there are no canvases or goal trees.",
    },
    {
      question: "Are there paid add-ons for Margaya?",
      answer:
        "No. Every feature is in the MIT-licensed code. Margaya Cloud is an optional managed service for teams that do not want to host it.",
    },
    {
      question: "Which licence is more permissive?",
      answer:
        "Margaya's MIT licence is permissive. Leantime's AGPLv3 is a copyleft licence that requires sharing changes when you offer a modified version over a network.",
    },
  ],
  related: ["openproject", "basecamp", "vikunja", "taiga"],
  screenshot: "list",
  reviewedOn: "2026-10-15",
};
