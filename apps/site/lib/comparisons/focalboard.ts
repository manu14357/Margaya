import type { Comparison } from "./types";

export const focalboard: Comparison = {
  slug: "focalboard",
  competitor: "Focalboard",
  categories: ["kanban", "open-source"],
  title: "Margaya vs Focalboard: an actively developed alternative",
  description:
    "Compare Margaya and Focalboard: an actively developed, MIT-licensed tracker with boards, lists, Gantt, cycles, intake and docs, free to self-host.",
  summary:
    "Boards, lists and calendars like Focalboard, plus planning, docs and steady releases.",
  verdict:
    "Choose Focalboard if your boards live inside Mattermost and that suits you; choose Margaya for an actively developed standalone tracker with planning, docs and regular upgrades.",
  glance: {
    hosting: "Self-host, standalone or as Boards in Mattermost",
    licence: "Open source, under Mattermost's licensing",
    pricing: "Free",
    bestFor: "Mattermost teams that want simple boards beside their chat",
    margayaBestFor:
      "Teams that want an actively developed board with planning and docs",
  },
  them: {
    cycles: "no",
    modules: "no",
    estimates: ["partial", "Number properties"],
    customFields: ["yes", "Card properties"],
    timeTracking: "no",
    relations: "no",
    board: "yes",
    list: ["yes", "Table view"],
    calendar: "yes",
    gantt: "no",
    savedViews: ["yes", "Board views"],
    pages: ["partial", "Card descriptions"],
    coEditing: "no",
    intake: "no",
    inbox: ["partial", "Through Mattermost"],
    publicBoards: ["partial", "Shared read-only links"],
    automations: "no",
    api: ["partial", "REST API"],
    mcp: ["no", "Not built in"],
    integrations: ["partial", "Mattermost"],
    openSource: "yes",
    selfHost: "yes",
    sso: ["partial", "Through Mattermost"],
    auditLog: "no",
    freeSelfHost: "yes",
    managedCloud: ["partial", "Through Mattermost"],
    allFeatures: "yes",
  },
  shines: [
    {
      title: "Next to your conversations",
      body: "As Boards inside Mattermost, cards sit beside the channels where the work is discussed, with one sign-in for both.",
    },
    {
      title: "Notion-like flexibility",
      body: "Card properties, board, table, gallery and calendar views let teams shape simple boards the way they like.",
    },
    {
      title: "Lightweight",
      body: "A standalone install is small and easy to try on a laptop or a modest server.",
    },
  ],
  different: [
    {
      title: "Actively developed",
      body: "Margaya ships regular releases with database migrations that are tested against existing installations, so upgrades keep your data intact.",
    },
    {
      title: "Planning when you need it",
      body: "Cycles, modules, estimates, relations, time tracking and a Gantt with dependency lines are available per project.",
    },
    {
      title: "Works with Mattermost too",
      body: "Margaya's Mattermost integration posts project updates into your channels, alongside Slack, Discord and Telegram integrations.",
    },
  ],
  migration:
    "Export a Focalboard board's table view as CSV. Import the file into a Margaya project and map titles, the status property, assignees, dates and select properties to Margaya fields.",
  faq: [
    {
      question: "Is Focalboard still maintained?",
      answer:
        "Check the project's repository for its current status; its development has slowed since Mattermost changed how Boards is supported. Margaya is actively developed and released.",
    },
    {
      question: "Can Margaya post to Mattermost?",
      answer:
        "Yes. The Mattermost integration sends project activity to a channel through an incoming webhook.",
    },
    {
      question: "Is Margaya free to self-host?",
      answer:
        "Yes, under the MIT licence, with every feature included. It runs with Docker Compose or Helm, next to PostgreSQL.",
    },
  ],
  related: ["wekan", "trello", "kanboard", "notion"],
  screenshot: "board",
  reviewedOn: "2026-10-15",
};
