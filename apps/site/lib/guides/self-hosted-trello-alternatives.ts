import { alternativePath } from "@/lib/comparisons/types";
import type { Guide } from "./types";

export const selfHostedTrelloAlternatives: Guide = {
  slug: "self-hosted-trello-alternatives",
  question: "Which self-hosted tool can replace Trello?",
  title: "Self-hosted Trello alternatives, and how to move your boards",
  description:
    "Open-source Trello alternatives you can run on your own server, compared honestly, plus a step-by-step move from Trello to a self-hosted Margaya board over CSV.",
  summary:
    "The open-source boards you can run yourself, and a step-by-step move from Trello over CSV.",
  answer:
    "WeKan is the closest to Trello's look and feel. Kanboard is the lightest. Vikunja suits personal and small-team task lists. Margaya suits teams who want a board plus list, calendar and Gantt views, docs and sprints in one tool. All four are open source and run on a single server. Moving across is a CSV export, a column mapping and a review.",
  topic: "self-host",
  timeNeeded: "30 minutes",
  before: [
    "Admin access to the Trello boards you're moving",
    "A server with Docker, or a Margaya Cloud workspace if you'd rather not host it",
  ],
  sections: [
    {
      heading: "The self-hosted options",
      body: [
        "All of these are open source, and each one runs comfortably on a small server. They differ in how much they try to do beyond the board.",
      ],
      items: [
        {
          name: "WeKan",
          href: alternativePath("wekan"),
          meta: "Closest to Trello",
          body: "Boards, lists, cards, swimlanes and checklists, laid out the way Trello users expect. Choose it if the board is all you need.",
        },
        {
          name: "Kanboard",
          href: alternativePath("kanboard"),
          meta: "Lightest",
          body: "A minimal board that runs almost anywhere, with column limits and plugins. The interface is plain by design.",
        },
        {
          name: "Vikunja",
          href: alternativePath("vikunja"),
          meta: "Personal and small teams",
          body: "Task lists first, with Kanban, Gantt and table views. Good for organising your own work, and a small team's.",
        },
        {
          name: "Margaya",
          meta: "Board plus planning and docs",
          body: "A board with list, backlog, spreadsheet, calendar and Gantt views over the same tasks, plus optional sprints, an intake queue and project docs. MIT licensed. We build it.",
        },
      ],
    },
    {
      heading: "Move a Trello board to Margaya",
      steps: [
        {
          title: "Start Margaya on your server",
          body: [
            "Follow the Docker Compose guide to get Margaya and PostgreSQL running behind HTTPS. If you'd rather not run a server, a Margaya Cloud workspace works the same way for the rest of these steps.",
          ],
        },
        {
          title: "Recreate your lists as columns",
          body: [
            "Create a project for the board, then open Settings > Projects > your project > Workflow. Add a column for each Trello list you want to keep, using the same names. The import matches statuses to columns by name, so this is what puts each card in the right place.",
            "Put each column in a group: Backlog, Not started, Started, Completed or Cancelled. That's what tells Margaya a Done list means done.",
          ],
        },
        {
          title: "Invite the people on the board",
          body: [
            "Open Settings > Members and invite everyone who has cards assigned to them. Assignees are matched to workspace members by email or exact name, so invite people before you import.",
          ],
        },
        {
          title: "Get your cards into a CSV file",
          body: [
            "Trello's export options depend on your plan, so check the board menu to see what you have. If you can export CSV, use that. If you only have JSON, turn the cards into a CSV file with a spreadsheet or a short script.",
            "Margaya needs one row per card with at least a title. These columns are worth including:",
          ],
          bullets: [
            "The card name, as Title.",
            "The card description, as Description.",
            "The list name, as Status.",
            "Label names separated by commas, as Labels.",
            "Member emails separated by commas, as Assignees.",
            "The due date, as Due date (for example 2026-10-31).",
          ],
        },
        {
          title: "Import, map and review",
          body: [
            "Open Settings > Projects > your project > General and choose Import. Upload the file, check the delimiter, and map each column to a Margaya field. Columns with matching names are mapped for you.",
            "The review step shows how many tasks will be created, which rows will be skipped for having no title, and which values don't match anything. A status that matches no column sends the card to the backlog instead of failing. Choose Import when it looks right.",
          ],
          callout: {
            tone: "note",
            title: "Limits",
            body: "One file holds up to 5 MB and 5,000 rows. Split a large board into several files and import them one after another.",
          },
          shot: {
            view: "board",
            alt: "Imported cards on a Margaya board, sorted into columns that match the original Trello lists.",
          },
        },
        {
          title: "Replace your Power-Ups",
          body: ["Most of the Power-Ups teams rely on are built into Margaya:"],
          bullets: [
            "Calendar: the Calendar layout, with drag to reschedule.",
            "Timeline: the Gantt layout, with dependency lines.",
            "Custom fields: per-project custom fields on every task.",
            "Card aging and cleanup: scheduled automations that archive or close untouched tasks.",
            "GitHub: the GitHub and Gitea integrations sync issues with tasks and link pull requests to them.",
            "Chat notifications: Slack, Discord, Mattermost and Telegram integrations, plus webhooks.",
          ],
        },
        {
          title: "Publish it, if the old board was public",
          body: [
            "If you used a public Trello board as a roadmap, open the project's … menu and choose Publish…. Visitors need no account. You decide whether they can vote, react, comment or send requests.",
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: "Can I keep using Trello while I try a self-hosted board?",
      answer:
        "Yes. Import a copy of one board, use it for a week or two, and only then move the rest. Nothing in the import changes your Trello data.",
    },
    {
      question: "Do attachments come across?",
      answer:
        "Not through CSV. If you need them, add their links to the description column before you import. For new uploads in Margaya, configure S3-compatible object storage on your server.",
    },
    {
      question: "How much server does a self-hosted board need?",
      answer:
        "Very little. Margaya's recommended minimum is 2 GB of RAM and 10 GB of disk, with Docker and Docker Compose. WeKan, Kanboard and Vikunja have similarly modest needs.",
    },
    {
      question: "Is there a mobile app?",
      answer:
        "Margaya has no native mobile apps. The web app works in a phone browser, and notifications can be sent to chat tools or email.",
    },
  ],
  next: [
    {
      label: "Self-host with Docker Compose",
      href: "/guides/self-host-project-management-docker",
      description: "From an empty server to HTTPS, backups and upgrades.",
    },
    {
      label: "CSV import reference",
      href: "/docs/core/functional/import-tasks-from-csv",
      description:
        "Every field you can map, and what happens to values that don't fit.",
    },
    {
      label: "Margaya vs Trello",
      href: alternativePath("trello"),
      description: "A side-by-side comparison.",
    },
  ],
  updatedOn: "2026-10-15",
};
