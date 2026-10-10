import { alternativePath } from "@/lib/comparisons/types";
import type { Guide } from "./types";

export const bestFreeKanbanBoardSoftware: Guide = {
  slug: "best-free-kanban-board-software",
  question: "Which free Kanban boards are worth using?",
  title: "Free Kanban board software, and how to run a board that stays fast",
  description:
    "The free Kanban tools worth trying in 2026, hosted and self-hosted, followed by a step-by-step setup for a Margaya board that stays fast and tidy as the work grows.",
  summary:
    "A short, fair list of free Kanban tools, then a board setup that stays tidy without weekly clean-ups.",
  answer:
    "If you want a free board you fully control, use an open-source tool you host yourself: Margaya, Vikunja, WeKan and Kanboard all qualify. Hosted free plans, such as Trello's, are fine for getting started but come with limits. Whichever you choose, a good board has few columns, one owner per card, and a habit of clearing out finished work.",
  topic: "plan",
  timeNeeded: "20 minutes",
  sections: [
    {
      heading: "Free Kanban tools worth trying",
      body: [
        "Free means two different things here. Open-source tools are free to run on your own server, and you pay for the server and the upkeep. Hosted tools often have a free plan, with limits on seats, boards or features that you should check before your team depends on it.",
      ],
      items: [
        {
          name: "Margaya",
          meta: "Open source (MIT) · self-hosted or Margaya Cloud",
          body: "A board plus list, backlog, spreadsheet, calendar and Gantt views over the same tasks, with a capture bar, keyboard shortcuts, saved views and cleanup automations. We build it, so weigh that.",
        },
        {
          name: "Vikunja",
          href: alternativePath("vikunja"),
          meta: "Open source · self-hosted",
          body: "A light task manager with list, Kanban, Gantt and table views. A good fit for individuals and small teams.",
        },
        {
          name: "WeKan",
          href: alternativePath("wekan"),
          meta: "Open source · self-hosted",
          body: "A board-first tool that feels familiar to anyone who has used Trello, with swimlanes and checklists.",
        },
        {
          name: "Kanboard",
          href: alternativePath("kanboard"),
          meta: "Open source · self-hosted",
          body: "Deliberately minimal and very light on resources, with column limits and a plugin system.",
        },
        {
          name: "Trello",
          href: alternativePath("trello"),
          meta: "Hosted · free plan with limits",
          body: "The most familiar board there is. Simple to start with, though larger teams soon reach for paid plans and Power-Ups.",
        },
      ],
    },
    {
      heading: "Set up a board that stays fast",
      body: [
        "The steps below use Margaya, but the habits carry over to any board.",
      ],
      steps: [
        {
          title: "Make the columns match how work really moves",
          body: [
            "Open Settings > Projects > your project > Workflow. Name each column after a stage work actually passes through, and put each one in the right group: Backlog, Not started, Started, Completed or Cancelled. The groups drive progress and analytics, so a column called Shipped still counts as done.",
            "Add a Cancelled column now. You'll need it for the cleanup automation later.",
          ],
        },
        {
          title: "Capture without leaving the board",
          body: [
            "Press `c` to jump to the capture bar and type the task as you'd say it. `@name`, `#label`, `!priority` and a date word such as `fri` become fields, and the rest stays in the title. `Enter` creates the card. `Ctrl Enter` opens the full editor.",
          ],
          code: {
            label: "Capture bar",
            content: "Fix broken signup link @sam #bug !urgent today",
          },
          shot: {
            view: "board",
            alt: "A Margaya board with columns of cards showing assignees, labels, priorities and due dates.",
          },
        },
        {
          title: "Move work with the mouse or the keyboard",
          body: [
            "Drag cards between columns as their status changes. On the keyboard, `j` and `k` move between cards, `Enter` opens one, and `x` selects it so you can change several cards together. With a card open, `s` changes its status.",
          ],
          callout: {
            tone: "tip",
            title: "Switch layouts, not tools",
            body: "The same tasks appear as a list, a spreadsheet, a calendar and a Gantt timeline. Press `v` then `l` for the list or `v` then `s` for the spreadsheet when you want to review rather than move.",
          },
        },
        {
          title: "Filter for stand-ups, then save the view",
          body: [
            "Filter by status, priority, assignee, labels or due date, and use Display to group, sub-group or choose which properties each card shows. With the Views feature on, Save view keeps the setup for you or the whole workspace. Lock a shared view so nobody changes it by accident.",
          ],
          shot: {
            view: "list",
            alt: "The Margaya list layout with tasks grouped by status and filters applied.",
          },
        },
        {
          title: "Let finished work clear itself",
          body: [
            "In the Workflow tab, under Scheduled automations, turn on Auto-archive closed tasks to archive completed and cancelled cards after one to twelve months without changes. Auto-close stale tasks moves open cards that nobody has touched into your Cancelled column.",
          ],
          callout: {
            tone: "note",
            title: "You see the effect first",
            body: "Before a rule runs, Margaya shows how many tasks it would affect and asks you to confirm. Archived tasks keep their history and can be restored at any time.",
          },
        },
        {
          title: "Share the board, if it helps",
          body: [
            "To show a roadmap or a bug list to people outside the workspace, open the project's … menu and choose Publish…. The public board is read-only until you allow votes, reactions, comments or requests, and you can unpublish or change the link at any time.",
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: "Is open-source Kanban software really free?",
      answer:
        "The licence is. Running it costs a small server and some of someone's time for updates and backups. If nobody wants that job, a hosted plan is the honest choice.",
    },
    {
      question: "Does Margaya limit boards, cards or users when self-hosted?",
      answer:
        "No. The self-hosted build has every feature and no limits on projects, tasks or members.",
    },
    {
      question: "Can I move my Trello boards to Margaya?",
      answer:
        "Yes, through CSV. Export or convert your cards to a CSV file, then open Settings > Projects > your project > General > Import. You map columns to fields and review the result before anything is created.",
    },
    {
      question: "Does Margaya have WIP limits?",
      answer:
        "Not as a column setting. Teams usually keep work in progress in check with a saved view grouped by assignee, or by reviewing the Started group in stand-ups.",
    },
  ],
  next: [
    {
      label: "Set up Margaya for a small team",
      href: "/guides/project-management-for-small-teams",
      description:
        "The interface, the capture bar and a two-minute daily routine.",
    },
    {
      label: "Run a self-hosted Trello alternative",
      href: "/guides/self-hosted-trello-alternatives",
      description: "Put a board on your own server and move your cards across.",
    },
    {
      label: "Views and filters",
      href: "/docs/core/functional/views",
      description: "Filters, display options, saved and locked views.",
    },
  ],
  updatedOn: "2026-10-15",
};
