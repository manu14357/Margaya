import type { Comparison } from "./types";

export const trello: Comparison = {
  slug: "trello",
  competitor: "Trello",
  categories: ["kanban"],
  title: "Margaya vs Trello: an open-source Trello alternative",
  description:
    "Compare Margaya and Trello: a fast kanban board plus list, spreadsheet, calendar and Gantt views, docs and intake, MIT licensed and free to self-host.",
  summary:
    "A board that stays as quick as Trello's, with lists, timelines and docs built in. Free to self-host.",
  verdict:
    "Choose Trello for the simplest possible shared board; choose Margaya when the board grows into real projects and you want every view included, on your own server if you like.",
  glance: {
    hosting: "Cloud only, run by Atlassian",
    licence: "Proprietary",
    pricing: "Free plan, then paid per-user plans",
    bestFor: "Personal boards and small teams who want the lightest tool",
    margayaBestFor:
      "Teams that outgrew one board and want lists, dates and docs without Power-Ups",
  },
  them: {
    cycles: "no",
    modules: "no",
    estimates: ["partial", "Through Power-Ups"],
    customFields: ["yes", "On paid plans"],
    timeTracking: ["partial", "Through Power-Ups"],
    relations: ["partial", "Checklists and linked cards"],
    board: "yes",
    list: ["partial", "Table view on Premium"],
    calendar: ["partial", "On Premium"],
    gantt: ["partial", "Timeline on Premium"],
    savedViews: ["partial", "On Premium"],
    pages: "no",
    coEditing: "no",
    intake: ["partial", "Personal inbox and email-to-board"],
    inbox: "yes",
    publicBoards: "yes",
    automations: ["yes", "Butler, with run limits by plan"],
    api: "yes",
    aiAssistant: ["partial", "AI capture on Standard, board AI on Premium"],
    mcp: ["no", "Not built in"],
    integrations: ["yes", "Power-Ups"],
    openSource: "no",
    selfHost: "no",
    sso: ["partial", "Enterprise, with Atlassian Guard"],
    auditLog: ["partial", "On higher plans"],
    freeSelfHost: "no",
    managedCloud: "yes",
    allFeatures: ["no", "Views and admin tiered by plan"],
  },
  shines: [
    {
      title: "Nothing to learn",
      body: "Lists, cards and drag and drop. Anyone can use a Trello board within a minute, which is why it spreads so easily through a company.",
    },
    {
      title: "A generous free plan",
      body: "Small teams and personal boards can run on Trello for a long time without paying anything.",
    },
    {
      title: "Butler and Power-Ups",
      body: "Rule-based automation and a large catalogue of Power-Ups let a board pick up just the extras it needs.",
    },
  ],
  different: [
    {
      title: "Every view is included",
      body: "Board, list, spreadsheet, calendar and Gantt are all part of Margaya, and you can save any filtered layout as a private or shared view.",
    },
    {
      title: "Room to grow",
      body: "When a board becomes a project, switch on cycles, modules, estimates or time tracking for it. Projects that do not need them stay as simple as before.",
    },
    {
      title: "Your board, your server",
      body: "Margaya is MIT licensed and self-hosts with Docker or Helm. Public boards let you share a roadmap with the world while the data stays on your infrastructure.",
    },
  ],
  migration:
    "Trello exports a board as CSV on paid plans and as JSON on every plan. Bring the cards in as CSV and map the columns to Margaya fields: lists become statuses, members match by email or name, and missing labels are created.",
  faq: [
    {
      question: "Is Margaya as simple as Trello?",
      answer:
        "On a new project, yes: a board, columns and a capture bar for adding tasks. Planning features such as cycles and estimates are off until someone turns them on for a project.",
    },
    {
      question: "Can I self-host a Trello alternative?",
      answer:
        "Yes. Margaya runs with Docker Compose or the Helm chart, needs only PostgreSQL, and is free to self-host under the MIT licence. Redis is optional and only needed when you run several API instances.",
    },
    {
      question: "Does Margaya have public boards like Trello?",
      answer:
        "Yes. You can publish a project as a public board that anyone with the link can open, and choose whether visitors may vote, react, comment or send requests.",
    },
  ],
  related: ["wekan", "kanboard", "asana", "focalboard"],
  screenshot: "board",
  reviewedOn: "2026-10-15",
};
