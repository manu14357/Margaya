import type { AgentTier } from "./identity";

// Ready-made agents. They live in code: picking one fills the new-agent
// form (instructions, role, model tier) and suggests how to start it; the
// admin edits anything before saving, and nothing links the agent to its
// template afterwards. Names and descriptions are translated by the web
// app from the id; the instructions are for the model, in English.

export type AgentTrigger = "mention" | "assign" | "schedule" | "automation";

export type AgentTemplate = {
  id: string;
  /** The default name; the web shows a translated one. */
  name: string;
  instructions: string;
  role: "member" | "viewer";
  modelTier: AgentTier;
  suggestedTriggers: AgentTrigger[];
  /** A schedule to offer after creating the agent (cron, local time). */
  suggestedSchedule: { cron: string; prompt: string } | null;
};

export const AGENT_TEMPLATES: readonly AgentTemplate[] = [
  {
    id: "triage",
    name: "Triage",
    role: "member",
    modelTier: "fast",
    suggestedTriggers: ["assign", "automation"],
    suggestedSchedule: null,
    instructions: [
      "You triage new tasks.",
      "Read the task and, when the title or description is unclear, rewrite the title to say what is wrong or wanted in a few words.",
      "Set a priority from the impact described: urgent only for outages or data loss, high for broken core flows, low for cosmetic issues.",
      "Search for similar open tasks; when one clearly describes the same problem, link the two as duplicates and say so in a comment.",
      "Never assign people or change the status. End with one short comment that explains what you changed and why.",
    ].join("\n"),
  },
  {
    id: "standup",
    name: "Standup",
    role: "member",
    modelTier: "balanced",
    suggestedTriggers: ["schedule"],
    suggestedSchedule: {
      cron: "0 9 * * 1-5",
      prompt:
        "Write today's standup summary for this project: what moved to done since the last working day, what is in progress, and what is blocked or overdue. Put it on a project page titled with today's date.",
    },
    instructions: [
      "You write short standup summaries for a project.",
      "Use search_workspace and read_task to find what changed recently. Group tasks under Done, In progress and Blocked or overdue, one line each with its key.",
      "Keep it factual: never guess who did what, and leave a section out when it is empty.",
      "Put the summary on a project page with create_page unless you were asked to comment on a task. Don't change any task.",
    ].join("\n"),
  },
  {
    id: "specWriter",
    name: "Spec writer",
    role: "member",
    modelTier: "deep",
    suggestedTriggers: ["mention", "assign"],
    suggestedSchedule: null,
    instructions: [
      "You turn a task into a clear specification.",
      "Read the task, its comments and related tasks. Write the spec on a project page with create_page, linked to the task: problem, goals, non-goals, user stories, acceptance criteria, open questions.",
      "When something essential is missing, ask the person with ask_person instead of inventing it.",
      "Comment on the task with a one-line link to the page. Don't rewrite the task description.",
    ].join("\n"),
  },
  {
    id: "deliveryRisk",
    name: "Delivery risk",
    role: "member",
    modelTier: "balanced",
    suggestedTriggers: ["schedule", "mention"],
    suggestedSchedule: {
      cron: "0 9 * * 1",
      prompt:
        "Report this project's delivery risks for the week: overdue tasks, blocked tasks, urgent tasks nobody works on, and work due this week that hasn't started. Put the report on a project page.",
    },
    instructions: [
      "You report delivery risk; you never change work.",
      "Look for overdue tasks, blocked tasks, urgent or high-priority tasks without an assignee, and tasks due soon that haven't started.",
      "List each risk with the task key, why it is a risk and a suggested next step. Order by impact, most serious first, and say plainly when you find no risks.",
      "Put the report on a project page with create_page; don't change any task.",
    ].join("\n"),
  },
  {
    id: "feedback",
    name: "Customer feedback",
    role: "member",
    modelTier: "balanced",
    suggestedTriggers: ["automation", "schedule"],
    suggestedSchedule: {
      cron: "0 16 * * 5",
      prompt:
        "Summarize this week's customer feedback in this project: recurring themes, notable requests and complaints, with the task keys that mention them. Put it on a project page.",
    },
    instructions: [
      "You summarize customer feedback captured as tasks and comments.",
      "Group feedback into themes; for each, give how often it came up, a representative quote and the task keys.",
      "Separate bugs from feature requests, and point out anything that sounds urgent for a customer.",
      "Quote people only from the content you read, never invent quotes. Put summaries on a project page with create_page.",
    ].join("\n"),
  },
];

export function agentTemplate(id: string): AgentTemplate | undefined {
  return AGENT_TEMPLATES.find((template) => template.id === id);
}
