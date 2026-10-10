import type { Comparison } from "./types";

export const notion: Comparison = {
  slug: "notion",
  competitor: "Notion",
  categories: ["all-in-one"],
  title: "Margaya vs Notion: a project tracker with docs built in",
  description:
    "Compare Margaya and Notion for project work: a real tracker with cycles, intake and Gantt, plus co-edited docs beside every project, MIT licensed and self-hostable.",
  summary:
    "A real tracker with docs beside every project, instead of a database you have to design.",
  verdict:
    "Choose Notion when writing is the centre of your team's work; choose Margaya when tracking is the point and you want docs that live next to the tasks, on a server you control.",
  glance: {
    hosting: "Cloud only",
    licence: "Proprietary",
    pricing: "Free plan, then paid per-member plans",
    bestFor: "Wikis, notes and flexible databases for the whole company",
    margayaBestFor:
      "Teams whose task database in Notion has turned into a tool they maintain",
  },
  them: {
    cycles: ["partial", "Sprints in Notion Projects"],
    modules: ["partial", "Relations between databases"],
    estimates: ["partial", "Number properties"],
    customFields: ["yes", "Database properties"],
    timeTracking: "no",
    relations: ["yes", "Sub-items and dependencies"],
    board: "yes",
    list: ["yes", "Table and list views"],
    calendar: "yes",
    gantt: ["yes", "Timeline view"],
    savedViews: "yes",
    pages: ["yes", "Notion's core strength"],
    coEditing: "yes",
    intake: ["yes", "Forms"],
    inbox: "yes",
    publicBoards: ["yes", "Publish pages to the web"],
    automations: ["yes", "Database automations on paid plans"],
    api: "yes",
    mcp: ["yes", "Official MCP server"],
    integrations: "yes",
    openSource: "no",
    selfHost: "no",
    sso: ["partial", "Business plans and up"],
    auditLog: ["partial", "Enterprise plan"],
    freeSelfHost: "no",
    managedCloud: "yes",
    allFeatures: ["no", "Features tiered by plan"],
  },
  shines: [
    {
      title: "Writing first",
      body: "Notion's editor, page nesting and templates make it one of the best places to write and organise knowledge.",
    },
    {
      title: "Databases you can shape",
      body: "Properties, relations, rollups and formulas let a team model almost any process from scratch.",
    },
    {
      title: "Publishing",
      body: "Any page can go public on the web in a few clicks, which makes Notion popular for handbooks and public roadmaps.",
    },
  ],
  different: [
    {
      title: "A tracker you do not have to build",
      body: "Statuses, priorities, assignees, estimates, cycles, modules and relations already exist and already work together, so nobody maintains the schema.",
    },
    {
      title: "Docs that belong to a project",
      body: "Each Margaya project has its own page tree with live co-editing, version history and backlinks to tasks, so specs sit right beside the work.",
    },
    {
      title: "Triage and notifications built for tasks",
      body: "Intake keeps incoming requests off the board until accepted, and the inbox and email digests tell each person what changed on the tasks they follow.",
    },
  ],
  migration:
    "Export a Notion database as Markdown & CSV and import the CSV into a Margaya project. Map the status, person, date and select properties to Margaya fields; longer pages can be pasted into project pages.",
  faq: [
    {
      question: "Can Margaya replace Notion?",
      answer:
        "For project tracking and project docs, yes. For a company wiki or general note-taking, Notion remains a broader writing tool, and many teams use both.",
    },
    {
      question: "Does Margaya have pages like Notion?",
      answer:
        "Margaya pages are rich documents inside a project, with nesting, live co-editing, version history, backlinks and private drafts. They are meant for specs and project notes rather than a whole company wiki.",
    },
    {
      question: "Is there a self-hosted Notion alternative for tasks?",
      answer:
        "Margaya is MIT licensed and self-hosts with Docker or Helm, with PostgreSQL as the only required service.",
    },
  ],
  related: ["clickup", "asana", "huly", "focalboard"],
  screenshot: "page",
  reviewedOn: "2026-10-15",
};
