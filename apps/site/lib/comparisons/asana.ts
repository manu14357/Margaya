import type { Comparison } from "./types";

export const asana: Comparison = {
  slug: "asana",
  competitor: "Asana",
  categories: ["all-in-one"],
  title: "Margaya vs Asana: an open-source Asana alternative",
  description:
    "Compare Margaya and Asana: boards, lists, calendar and Gantt, intake, docs and time tracking in an open-source tool you can self-host or use in the cloud.",
  summary:
    "Lists, timelines and request intake for project teams, MIT licensed and free to self-host.",
  verdict:
    "Choose Asana to coordinate many departments with portfolios and goals; choose Margaya for focused project work with every view included and data you can keep on your own servers.",
  glance: {
    hosting: "Cloud only",
    licence: "Proprietary",
    pricing: "Free plan, then paid per-seat plans",
    bestFor: "Cross-department coordination, portfolios and goals",
    margayaBestFor:
      "Project teams who want lists, timelines and intake without per-seat tiers",
  },
  them: {
    cycles: ["partial", "No native sprints; sections or templates"],
    modules: ["yes", "Milestones and portfolios"],
    estimates: ["partial", "Through custom fields"],
    customFields: ["yes", "On paid plans"],
    timeTracking: ["yes", "On higher plans"],
    relations: ["yes", "Subtasks and dependencies"],
    board: "yes",
    list: "yes",
    calendar: "yes",
    gantt: ["yes", "Timeline and Gantt on paid plans"],
    savedViews: ["partial", "Saved searches and reports"],
    pages: ["partial", "Project briefs"],
    coEditing: ["partial", "In project briefs"],
    intake: ["yes", "Forms on paid plans"],
    inbox: "yes",
    publicBoards: "no",
    automations: ["yes", "Rules on paid plans"],
    api: "yes",
    aiAssistant: ["yes", "AI Studio and AI Teammates, on paid plans"],
    mcp: ["yes", "Official MCP server"],
    integrations: "yes",
    openSource: "no",
    selfHost: "no",
    sso: ["partial", "Higher tiers"],
    auditLog: ["partial", "Enterprise tiers"],
    freeSelfHost: "no",
    managedCloud: "yes",
    allFeatures: ["no", "Features tiered by plan"],
  },
  shines: [
    {
      title: "Work across the whole company",
      body: "Portfolios, goals and workload views let a programme manager see dozens of projects roll up into one status, which is where Asana is strongest.",
    },
    {
      title: "Approachable for non-engineers",
      body: "Marketing, operations and HR teams pick Asana up quickly, and its templates cover a wide range of business processes.",
    },
    {
      title: "Mature rules and forms",
      body: "Request forms feed projects directly, and rules route and update tasks without anyone touching them.",
    },
  ],
  different: [
    {
      title: "Built for the work, not the org chart",
      body: "Margaya concentrates on projects: boards, lists, a spreadsheet, a calendar and a Gantt timeline with dependency lines, plus cycles and modules when a team wants them.",
    },
    {
      title: "Intake that keeps the board clean",
      body: "Requests wait in an intake queue until someone accepts, declines, snoozes or marks them as duplicates, so the board only holds work the team agreed to.",
    },
    {
      title: "No tiers to climb",
      body: "Custom fields, time tracking, the timeline and single sign-on are part of every self-hosted Margaya, and the source is MIT licensed.",
    },
  ],
  migration:
    "Asana exports any project as CSV. Map its columns to Margaya fields in the CSV import: sections become statuses, assignees match workspace members, and dates, tags and descriptions carry over.",
  faq: [
    {
      question: "Is there an open-source Asana alternative?",
      answer:
        "Margaya is one: MIT licensed, free to self-host with every feature, and available as a managed cloud if you would rather not run it.",
    },
    {
      question: "Does Margaya have Asana-style forms?",
      answer:
        "Margaya has an intake queue for incoming requests, and a published project board can let visitors send requests that land in it. Requests stay out of the board until someone accepts them.",
    },
    {
      question: "What does Asana have that Margaya does not?",
      answer:
        "Portfolios, company goals and workload balancing. Margaya focuses on projects and leaves cross-company reporting to analytics and exports.",
    },
  ],
  related: ["monday", "clickup", "wrike", "basecamp"],
  screenshot: "list",
  reviewedOn: "2026-10-15",
};
