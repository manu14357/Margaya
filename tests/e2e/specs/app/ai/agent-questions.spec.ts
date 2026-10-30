import type { Locator, Page, Request, Route } from "@playwright/test";
import { expect, test } from "../../../fixtures";
import { E2E_API_URL } from "../../../helpers/env";
import {
  createProject,
  createTask,
  deleteProject,
  type TestProject,
  type TestTask,
  taskPagePath,
} from "../../../helpers/task-data";
import { openTaskPage, toast } from "../../../helpers/task-ui";
import { uniqueName } from "../../../helpers/ui";
import type { SeedManifest } from "../../../seed/seed";

// An agent that paused its run to ask the person something: the question
// card at the top of the task's Activity, the bell's "has a question"
// notification and the Agent Desk's question panel.
//
// The e2e instance runs with AI off and no model, so no real run can ever
// reach needs_input. These specs fake ONLY the AI endpoints the UI reads
// (availability, the run lists, one run's detail, the approvals list and the
// reply) with page.route, and splice one notification into the real inbox
// page. The task, project, workspace and every other request stay real.

// The dev servers are shared with other suites; allow slow page loads.
test.describe.configure({ timeout: 300_000 });
test.use({ navigationTimeout: 120_000 });

const AGENT_NAME = "Spec Bot";

type Question = { text: string; options: string[] };

type FakeAgent = {
  /** The bodies POSTed to the run's reply route. */
  replies: { workspaceId: string; text: string }[];
};

let project: TestProject;
let task: TestTask;

test.beforeEach(async ({ api }) => {
  project = await createProject(api, { name: uniqueName("Agent questions") });
  task = await createTask(api, project.id, {
    title: uniqueName("Agent asks"),
  });
});

test.afterEach(async ({ api }) => {
  if (project) await deleteProject(api, project.id);
});

/** An API request of this page, matched on its exact path. */
function apiPath(pathname: string) {
  return (url: URL) => url.origin === E2E_API_URL && url.pathname === pathname;
}

/** An AgentRun (apps/api/src/ai-agent/response.ts, agentRunSchema). */
function agentRun(
  seed: SeedManifest,
  runId: string,
  question: Question | null,
) {
  return {
    id: runId,
    agent: {
      id: `agent-${runId}`,
      userId: `agent-user-${runId}`,
      name: AGENT_NAME,
    },
    principal: { id: seed.users.owner.id, name: "Olivia Owner" },
    task: {
      id: task.id,
      projectId: project.id,
      key: `${project.slug}-${task.number}`,
      title: task.title,
    },
    project: { id: project.id, name: project.name, slug: project.slug },
    trigger: "mention",
    followUpOf: null,
    status: question ? "needs_input" : "queued",
    question,
    request: null,
    error: null,
    outputSummary: null,
    tokenIn: 1200,
    tokenOut: 300,
    costMicros: 0,
    toolCalls: 2,
    pendingApprovals: 0,
    appliedChanges: 0,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    startedAt: new Date(Date.now() - 55_000).toISOString(),
    finishedAt: null,
  };
}

/**
 * Turn AI on for this page and give the owner one run on the task that
 * waits for an answer. Answering it (POST …/reply) moves the run on, so the
 * needs_input list comes back empty afterwards, as the real API's would.
 */
async function fakeAgentRun(
  page: Page,
  seed: SeedManifest,
  runId: string,
  first: Question,
): Promise<FakeAgent> {
  let question: Question | null = first;
  const replies: FakeAgent["replies"] = [];
  const json = (route: Route, body: unknown) =>
    route.fulfill({ status: 200, json: body });

  await page.route(apiPath("/api/ai/availability"), (route) =>
    json(route, {
      available: true,
      instanceEnabled: true,
      configured: true,
      workspaceEnabled: true,
      projectEnabled: true,
      canUse: true,
      canManage: false,
      destination: "cloud",
      provider: "anthropic",
      zeroRetention: false,
      requireApprovalForWrites: true,
      autoTranslateComments: false,
      model: "e2e-fake-model",
      features: {
        webSearch: false,
        storeConversations: false,
        autopilot: false,
        speech: false,
        showReasoning: false,
      },
    }),
  );

  await page.route(apiPath("/api/ai/agents/runs"), (route, request) => {
    const query = new URL(request.url()).searchParams;
    const run = agentRun(seed, runId, question);
    const taskId = query.get("taskId");
    const status = query.get("status");
    const matches =
      (!taskId || taskId === task.id) && (!status || status === run.status);
    return json(route, matches ? [run] : []);
  });

  await page.route(apiPath(`/api/ai/agents/runs/${runId}`), (route) =>
    json(route, { ...agentRun(seed, runId, question), steps: [] }),
  );

  await page.route(apiPath("/api/ai/agents/approvals"), (route) =>
    json(route, []),
  );

  await page.route(
    apiPath(`/api/ai/agents/runs/${runId}/reply`),
    (route, request: Request) => {
      if (request.method() !== "POST") return route.fallback();
      replies.push(request.postDataJSON());
      question = null;
      return json(route, { id: runId, status: "queued" });
    },
  );

  return { replies };
}

/** The question card, a region named after its title. */
function questionCard(
  page: Page | Locator,
  title = `${AGENT_NAME} has a question`,
) {
  return page.getByRole("region", { name: title, exact: true });
}

test("the task shows the agent's question and an option answers it", async ({
  page,
  seed,
}) => {
  const runId = `run-${Date.now().toString(36)}`;
  const agent = await fakeAgentRun(page, seed, runId, {
    text: "Which environment should I deploy to?",
    options: ["Staging", "Production"],
  });

  await openTaskPage(page, taskPagePath(project.id, task.id));
  const activity = page.getByRole("region", { name: "Activity" });
  // The card sits at the top of Activity, above the comment composer.
  const card = questionCard(activity);
  await expect(card).toBeVisible({ timeout: 30_000 });
  const composer = activity
    .getByRole("region", { name: "Comment editor" })
    .last();
  const cardBox = await card.boundingBox();
  const composerBox = await composer.boundingBox();
  expect(cardBox && composerBox && cardBox.y < composerBox.y).toBe(true);
  await expect(card).toContainText("Which environment should I deploy to?");
  await expect(card.getByRole("button", { name: "Staging" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Production" })).toBeVisible();
  await expect(
    card.getByText("Unanswered questions expire after 24 hours."),
  ).toBeVisible();

  await card.getByRole("button", { name: "Staging" }).click();
  await expect(toast(page, "Answer sent. The agent continues.")).toBeVisible();
  await expect(card).toHaveCount(0);
  expect(agent.replies).toEqual([
    { workspaceId: seed.workspace.id, text: "Staging" },
  ]);
});

test("a free-text answer goes to the agent too", async ({ page, seed }) => {
  const runId = `run-${Date.now().toString(36)}`;
  const agent = await fakeAgentRun(page, seed, runId, {
    text: "What should the release note say?",
    options: [],
  });

  await openTaskPage(page, taskPagePath(project.id, task.id));
  const card = questionCard(page);
  await expect(card).toContainText("What should the release note say?", {
    timeout: 30_000,
  });
  const send = card.getByRole("button", { name: "Reply", exact: true });
  await expect(send).toBeDisabled();
  await card
    .getByRole("textbox", { name: "Your answer" })
    .fill("  Faster boards and threaded comments  ");
  await send.click();
  await expect(toast(page, "Answer sent. The agent continues.")).toBeVisible();
  await expect(card).toHaveCount(0);
  // The answer is trimmed before it is sent.
  expect(agent.replies).toEqual([
    {
      workspaceId: seed.workspace.id,
      text: "Faster boards and threaded comments",
    },
  ]);
});

test("the bell's question notification opens the run in the Agent Desk", async ({
  page,
  seed,
}) => {
  const runId = `run-${Date.now().toString(36)}`;
  const agent = await fakeAgentRun(page, seed, runId, {
    text: "Should I close the duplicate tasks?",
    options: ["Yes", "No"],
  });
  const notificationId = `notification-${runId}`;
  const now = new Date().toISOString();
  // An InboxNotification (apps/api/src/notification/response.ts) as the
  // agent runner writes it when a run pauses for input.
  const question = {
    id: notificationId,
    userId: seed.users.owner.id,
    title: null,
    content: null,
    type: "ai_agent_reply",
    eventData: {
      runId,
      agentId: `agent-${runId}`,
      agentName: AGENT_NAME,
      needsInput: true,
      projectId: project.id,
      workspaceId: seed.workspace.id,
      taskTitle: task.title,
    },
    isRead: false,
    resourceId: task.id,
    resourceType: "task",
    workspaceId: seed.workspace.id,
    actorId: null,
    archivedAt: null,
    snoozedUntil: null,
    resurfacedAt: null,
    createdAt: now,
    updatedAt: now,
    actor: null,
    task: {
      id: task.id,
      key: `${project.slug}-${task.number}`,
      title: task.title,
      projectId: project.id,
      projectName: project.name,
    },
    sortAt: now,
    isSnoozed: false,
  };
  // Splice the notification into the real first inbox page.
  await page.route(apiPath("/api/notification/inbox"), async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get("cursor") || query.get("view") !== "inbox") {
      return route.fallback();
    }
    const response = await route.fetch();
    const body = (await response.json()) as { items: unknown[] };
    return route.fulfill({
      response,
      json: { ...body, items: [question, ...body.items] },
    });
  });
  await page.route(
    apiPath(`/api/notification/${notificationId}/read`),
    (route) =>
      route.fulfill({ status: 200, json: { ...question, isRead: true } }),
  );

  // With no run chosen, the desk invites picking one.
  await page.goto(`/dashboard/workspace/${seed.workspace.id}/agents`);
  await expect(page.getByText("See what your agents did")).toBeVisible({
    timeout: 60_000,
  });

  await page
    .getByRole("button", { name: "Notifications", exact: true })
    .first()
    .click();
  const item = page
    .getByRole("menuitem")
    .filter({ hasText: `${AGENT_NAME} has a question` });
  await expect(item).toBeVisible();
  await item.click();

  await expect(page).toHaveURL(
    new RegExp(
      `/dashboard/workspace/${seed.workspace.id}/agents\\?runId=${runId}$`,
    ),
  );
  // The desk names the run in its header, so the panel's title is generic.
  const panel = questionCard(page, "The agent has a question");
  await expect(panel).toContainText("Should I close the duplicate tasks?");
  await expect(panel.getByRole("button", { name: "Yes" })).toBeVisible();
  await expect(page.getByText("See what your agents did")).toHaveCount(0);

  await panel.getByRole("button", { name: "No" }).click();
  await expect(toast(page, "Answer sent. The agent continues.")).toBeVisible();
  await expect(panel).toHaveCount(0);
  expect(agent.replies).toEqual([
    { workspaceId: seed.workspace.id, text: "No" },
  ]);
});
