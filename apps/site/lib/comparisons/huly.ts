import type { Comparison } from "./types";

export const huly: Comparison = {
  slug: "huly",
  competitor: "Huly",
  categories: ["all-in-one", "open-source"],
  title: "Margaya vs Huly: a focused open-source alternative",
  description:
    "Compare Margaya and Huly: an MIT-licensed project tracker with cycles, Gantt, intake and live docs that runs as a single container plus PostgreSQL.",
  summary:
    "A focused tracker with docs, in one container plus PostgreSQL, instead of a full team platform.",
  verdict:
    "Choose Huly to replace chat, docs, meetings and tracking with one platform; choose Margaya for a focused project tracker that is small to run and plays well with the chat tools you already use.",
  glance: {
    hosting: "Self-host, or Huly's cloud",
    licence: "EPL-2.0",
    pricing: "Free to self-host; cloud with free and paid tiers",
    bestFor: "Teams that want chat, docs, meetings and tracking in one app",
    margayaBestFor:
      "Teams that want a focused tracker that is simple to host and upgrade",
  },
  them: {
    cycles: ["partial", "Milestones"],
    modules: ["yes", "Components and milestones"],
    estimates: ["yes", "Time estimates"],
    customFields: ["yes", "Custom attributes"],
    timeTracking: ["yes", "Time reports"],
    relations: ["yes", "Sub-issues and relations"],
    board: "yes",
    list: "yes",
    calendar: ["yes", "Planner and calendar"],
    gantt: "no",
    savedViews: "yes",
    pages: ["yes", "Documents"],
    coEditing: "yes",
    intake: "no",
    inbox: "yes",
    publicBoards: "no",
    automations: "no",
    api: ["partial", "API client libraries"],
    aiAssistant: ["no", "Huly AI announced, not yet released"],
    mcp: ["no", "Not built in"],
    integrations: ["yes", "GitHub sync, Telegram and email"],
    openSource: ["yes", "EPL-2.0"],
    selfHost: ["yes", "Multi-service stack"],
    sso: ["partial", "Depends on deployment"],
    auditLog: ["partial", "Activity history"],
    freeSelfHost: "yes",
    managedCloud: "yes",
    allFeatures: ["partial", "Cloud tiers by usage"],
  },
  shines: [
    {
      title: "Everything in one app",
      body: "Chat, video meetings, a virtual office, documents and an issue tracker share one workspace, which can replace several subscriptions at once.",
    },
    {
      title: "Two-way GitHub sync",
      body: "Issues and pull requests stay in step with GitHub, which suits teams working in public repositories.",
    },
    {
      title: "Ambitious and open",
      body: "Huly is developed in the open and free to self-host, with a fast-moving roadmap.",
    },
  ],
  different: [
    {
      title: "Focused on the work",
      body: "Margaya is a project tracker with docs, not a communication suite. It connects to Slack, Discord, Mattermost and Telegram rather than replacing them.",
    },
    {
      title: "Small to run",
      body: "One application container and PostgreSQL, with Redis optional. Docker Compose and a Helm chart are both maintained.",
    },
    {
      title: "Planning depth",
      body: "Cycles with burndown, a Gantt with dependency lines, estimates, intake triage and saved views give teams structure when they want it.",
    },
  ],
  migration:
    "Collect the Huly issues you want to keep in a spreadsheet, save it as CSV, and map titles, statuses, assignees, labels and dates in Margaya's CSV import.",
  faq: [
    {
      question: "Does Margaya include chat or video?",
      answer:
        "No. Margaya sends notifications to Slack, Discord, Mattermost, Telegram, ntfy or Gotify, and keeps discussion on tasks and pages through comments and mentions.",
    },
    {
      question: "Which is lighter to self-host?",
      answer:
        "Margaya runs as a single application container plus PostgreSQL. Huly's self-hosted setup includes several services because it covers more ground.",
    },
    {
      question: "Are both open source?",
      answer:
        "Yes. Huly is EPL-2.0 and Margaya is MIT, a permissive licence that places few conditions on reuse.",
    },
  ],
  related: ["linear", "notion", "clickup", "openproject"],
  screenshot: "page",
  reviewedOn: "2026-10-15",
};
