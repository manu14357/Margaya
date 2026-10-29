import type { Comparison } from "./types";

export const monday: Comparison = {
  slug: "monday",
  competitor: "monday.com",
  categories: ["all-in-one"],
  title: "Margaya vs monday.com: an open-source monday.com alternative",
  description:
    "Compare Margaya and monday.com: boards, spreadsheet, calendar and Gantt, custom fields, intake and docs in an MIT-licensed tool that is free to self-host.",
  summary:
    "Spreadsheet-style tracking, timelines and intake for project teams, MIT licensed.",
  verdict:
    "Choose monday.com for a configurable work platform that also covers CRM and service boards; choose Margaya for a focused project tracker with every feature included and nothing per seat when self-hosted.",
  glance: {
    hosting: "Cloud only",
    licence: "Proprietary",
    pricing: "Free plan, then paid per-seat plans",
    bestFor:
      "Business teams building many kinds of boards, dashboards and forms",
    margayaBestFor:
      "Teams that mainly run projects and want spreadsheet speed without seat tiers",
  },
  them: {
    cycles: ["partial", "Sprints in monday dev"],
    modules: ["partial", "Groups, or epics in monday dev"],
    estimates: ["partial", "Number columns"],
    customFields: ["yes", "Many column types"],
    timeTracking: ["yes", "Time tracking column on higher plans"],
    relations: ["yes", "Subitems and dependencies"],
    board: "yes",
    list: ["yes", "The main table"],
    calendar: "yes",
    gantt: ["yes", "Timeline and Gantt on paid plans"],
    savedViews: "yes",
    pages: ["yes", "Workdocs"],
    coEditing: "yes",
    intake: ["yes", "Forms"],
    inbox: "yes",
    publicBoards: ["partial", "Shareable boards on paid plans"],
    automations: ["yes", "Recipes with monthly action limits"],
    api: ["yes", "GraphQL API and webhooks"],
    aiAssistant: ["yes", "Sidekick and agents on paid plans, with AI credits"],
    mcp: ["yes", "Official MCP server"],
    integrations: ["yes", "Large app marketplace"],
    openSource: "no",
    selfHost: "no",
    sso: ["partial", "Enterprise plan"],
    auditLog: ["partial", "Enterprise plan"],
    freeSelfHost: "no",
    managedCloud: "yes",
    allFeatures: ["no", "Features tiered by plan"],
  },
  shines: [
    {
      title: "One platform, many shapes",
      body: "The same boards can run a sales pipeline, a content calendar or a service queue, with dashboards that pull them together.",
    },
    {
      title: "Visual and friendly",
      body: "Colourful column types and templates make monday.com easy for teams who have never used a tracker before.",
    },
    {
      title: "Automation recipes",
      body: "Plain-language recipes connect boards to each other and to external tools without code.",
    },
  ],
  different: [
    {
      title: "A spreadsheet that is still a tracker",
      body: "Margaya's spreadsheet layout edits fields inline, while statuses, cycles, modules and relations keep the work structured. Save the layout as a shared view.",
    },
    {
      title: "Everything included",
      body: "Gantt, time tracking, custom fields, the audit log and single sign-on are part of every self-hosted Margaya, with no seat bundles.",
    },
    {
      title: "Owned by you",
      body: "The source is MIT licensed, the data sits in your PostgreSQL, and any project exports to CSV or JSON whenever you like.",
    },
  ],
  migration:
    "Export a monday.com board to Excel, save it as CSV, and map its columns in Margaya's CSV import. Status columns become workflow columns, people match workspace members, and dates and text carry over.",
  faq: [
    {
      question: "Is Margaya a cheaper alternative to monday.com?",
      answer:
        "Self-hosting Margaya costs nothing beyond your server, with no seat limits. Margaya Cloud is a managed subscription; the pricing page has the current plans.",
    },
    {
      question: "Does Margaya have dashboards?",
      answer:
        "Margaya has workspace and project analytics: open, created and completed work, breakdowns by assignee, label or cycle, and CSV export of any table. It does not build custom dashboards from widgets.",
    },
    {
      question: "Can Margaya replace monday.com for non-project work?",
      answer:
        "Margaya is built for project and task tracking. If you use monday.com as a CRM or a service desk, those boards are better served by a tool designed for them.",
    },
  ],
  related: ["asana", "clickup", "wrike", "notion"],
  screenshot: "spreadsheet",
  reviewedOn: "2026-10-15",
};
