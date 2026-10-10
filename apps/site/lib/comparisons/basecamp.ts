import type { Comparison } from "./types";

export const basecamp: Comparison = {
  slug: "basecamp",
  competitor: "Basecamp",
  categories: ["all-in-one"],
  title: "Margaya vs Basecamp: an open-source Basecamp alternative",
  description:
    "Compare Margaya and Basecamp: boards, lists, a calendar and Gantt, cycles and intake, plus co-edited docs, in an MIT-licensed tool you can self-host.",
  summary:
    "Structured project tracking with docs, for teams that need more than to-do lists.",
  verdict:
    "Choose Basecamp to run calm company communication around projects; choose Margaya when the projects themselves need structure: statuses, estimates, dependencies and views.",
  glance: {
    hosting: "Cloud only",
    licence: "Proprietary",
    pricing: "Per-user plan, or a flat-rate plan for unlimited users",
    bestFor:
      "Agencies and companies that want messages, chat and to-dos together",
    margayaBestFor:
      "Teams whose projects need workflows, dependencies and planning views",
  },
  them: {
    cycles: "no",
    modules: ["partial", "To-do lists and Hill Charts"],
    estimates: "no",
    customFields: "no",
    timeTracking: ["partial", "Through add-ons"],
    relations: ["partial", "Steps on cards"],
    board: ["yes", "Card Table"],
    list: ["yes", "To-do lists"],
    calendar: ["yes", "Schedule"],
    gantt: ["partial", "Lineup of projects"],
    savedViews: "no",
    pages: ["yes", "Docs & Files"],
    coEditing: ["partial", "Shared docs, not live co-editing"],
    intake: ["partial", "Client access and email forwards"],
    inbox: "yes",
    publicBoards: ["partial", "Public links to items"],
    automations: ["partial", "Automatic check-ins"],
    api: ["yes", "REST API and webhooks"],
    mcp: ["no", "Not built in"],
    integrations: ["partial", "Third-party add-ons"],
    openSource: "no",
    selfHost: "no",
    sso: ["partial", "Google sign-in"],
    auditLog: ["partial", "Activity reports"],
    freeSelfHost: "no",
    managedCloud: "yes",
    allFeatures: ["partial", "Paid plans include everything"],
  },
  shines: [
    {
      title: "Communication around the work",
      body: "Message boards, Campfire chat, automatic check-ins and docs give each project a calm home for discussion, not just tasks.",
    },
    {
      title: "Working with clients",
      body: "Client access lets agencies share exactly the right parts of a project with the people paying for it.",
    },
    {
      title: "Predictable pricing",
      body: "A flat-rate option means growing headcount does not change the bill.",
    },
  ],
  different: [
    {
      title: "Structure when projects need it",
      body: "Custom workflows, priorities, estimates, custom fields and task relations give larger projects a shape that to-do lists cannot.",
    },
    {
      title: "Plan in time",
      body: "Calendar and Gantt views, cycles with burndown charts and modules with progress show where the work stands and where it is heading.",
    },
    {
      title: "Self-host it",
      body: "Margaya is MIT licensed and runs on your own server with Docker or Helm. Nothing per seat, and every feature included.",
    },
  ],
  migration:
    "Basecamp can export an account's data as a downloadable archive. Collect the to-dos you want to keep in a spreadsheet, save it as CSV, and map it in Margaya's CSV import; assignees match by email or name.",
  faq: [
    {
      question: "Does Margaya have message boards or chat?",
      answer:
        "No. Margaya keeps discussion on tasks and pages through comments, mentions and reactions, and connects to Slack, Discord, Mattermost or Telegram for chat.",
    },
    {
      question: "Can clients see a Margaya project?",
      answer:
        "You can publish a project as a public board and choose what visitors see and do, or invite people into the workspace with a read-only role.",
    },
    {
      question: "Is Margaya free?",
      answer:
        "Self-hosting is free under the MIT licence. Margaya Cloud is a managed subscription; see the pricing page.",
    },
  ],
  related: ["asana", "trello", "leantime", "notion"],
  screenshot: "board",
  reviewedOn: "2026-10-15",
};
