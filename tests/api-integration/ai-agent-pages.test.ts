import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resetAiGatewayState,
  setAiProviderFactory,
} from "../../apps/api/src/ai/gateway";
import {
  type FakeReply,
  setFakeResponder,
} from "../../apps/api/src/ai/provider/fake";
import type { ChatRequest } from "../../apps/api/src/ai/types";
import { saveWorkspaceAiSettings } from "../../apps/api/src/ai/workspace-settings";
import { drainAgentRuns } from "../../apps/api/src/ai-agent/runner";
import { AGENT_TEMPLATES } from "../../apps/api/src/ai-agent/templates";
import { settleAuditWrites } from "../../apps/api/src/audit-log/record";
import db from "../../apps/api/src/database";
import {
  activityTable,
  auditLogTable,
  pageTable,
  pageVersionTable,
} from "../../apps/api/src/database/schema";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import { resetTestDatabase } from "./helpers/database";
import { draftScene } from "./helpers/drafts";

// Agents editing existing pages (update_page): rights, the change set,
// approval, undo that refuses after a person's edit, and a spec writer that
// revises the task's page instead of creating another copy. Also the id
// scrubber on the agent's comment and summary.

type Scene = Awaited<ReturnType<typeof draftScene>>;
type User = Scene["mia"];
type AgentJson = { id: string; userId: string; name: string };
type StepJson = {
  id: string;
  kind: string;
  toolName: string | null;
  status: string;
  reason: string | null;
  canUndo: boolean;
  change: Record<string, unknown> | null;
  links: { taskUrl: string | null; createdUrl: string | null };
};
type RunJson = {
  id: string;
  status: string;
  outputSummary: string | null;
  steps: StepJson[];
};
type PageJson = { id: string; title: string; contentMarkdown: string };

const AI_ENV = [
  "MARGAYA_AI_ENABLED",
  "MARGAYA_AI_PROVIDER",
  "MARGAYA_AI_USER_CONCURRENCY",
] as const;

beforeEach(async () => {
  await resetTestDatabase();
  resetRateLimitMemory();
  resetAiGatewayState();
});

afterEach(async () => {
  for (const name of AI_ENV) delete process.env[name];
  setFakeResponder(null);
  setAiProviderFactory(null);
  await settleAuditWrites();
});

const marker = (tool: string, args: Record<string, unknown>) =>
  `[[fake:tool:${tool} ${JSON.stringify(args)}]]`;

async function agentScene(agent: Record<string, unknown> = {}) {
  process.env.MARGAYA_AI_ENABLED = "true";
  process.env.MARGAYA_AI_PROVIDER = "fake";
  process.env.MARGAYA_AI_USER_CONCURRENCY = "0";
  const s = await draftScene();
  await saveWorkspaceAiSettings(s.workspaceId, { enabled: true }, s.owner.id);
  const bot = await s.ok<AgentJson>(s.owner, "POST", "/ai/agents", {
    workspaceId: s.workspaceId,
    name: "Spec Bot",
    instructions: "Write clear specs.",
    ...agent,
  });
  const task = await s.ok<{ id: string; number: number }>(
    s.mia,
    "POST",
    `/task/${s.web.project.id}`,
    {
      title: "Login page",
      description: "Design the login page.",
      priority: "low",
      status: "to-do",
      assigneeIds: [],
    },
  );
  const key = `${s.web.project.slug.toUpperCase()}-${task.number}`;
  /** A page linked to the task, as create_page writes it. */
  const linkedPage = (content: string, extra: Record<string, unknown> = {}) =>
    s.ok<PageJson>(s.mia, "POST", `/page/project/${s.web.project.id}`, {
      title: "Login spec",
      content: `<margaya-issue-link url="/t" issue-key="${key}" task-id="${task.id}" />\n\n${content}`,
      ...extra,
    });
  return { s, bot, task, key, linkedPage };
}

async function run(
  s: Scene,
  user: User,
  agentId: string,
  taskId: string,
  prompt: string,
): Promise<RunJson> {
  const started = await s.ok<{ id: string }>(
    user,
    "POST",
    `/ai/agents/${agentId}/runs`,
    { workspaceId: s.workspaceId, taskId, prompt },
  );
  await drainAgentRuns();
  return s.ok<RunJson>(
    user,
    "GET",
    `/ai/agents/runs/${started.id}?workspaceId=${s.workspaceId}`,
  );
}

const toolSteps = (r: RunJson) =>
  r.steps.filter((step) => step.kind === "tool");

async function pageRow(id: string) {
  const [row] = await db.select().from(pageTable).where(eq(pageTable.id, id));
  return row;
}

const projectPages = (projectId: string) =>
  db.select().from(pageTable).where(eq(pageTable.projectId, projectId));

describe("update_page", () => {
  it("edits through the content route with a version, and undo restores the page", async () => {
    const { s, bot, task, linkedPage } = await agentScene();
    const page = await linkedPage("Old draft.");
    const result = await run(
      s,
      s.mia,
      bot.id,
      task.id,
      `Revise it ${marker("update_page", { page: page.id, title: "Login page specification", content: "## Goals\n\nFast login." })}`,
    );
    const [step] = toolSteps(result);
    expect(step).toMatchObject({
      toolName: "update_page",
      status: "applied",
      canUndo: true,
    });
    expect(step?.change).toMatchObject({
      op: "update_page",
      pageId: page.id,
      mode: "replace",
      before: { title: "Login spec" },
      after: { title: "Login page specification" },
    });
    expect(step?.links.createdUrl).toBe(
      `/dashboard/workspace/${s.workspaceId}/project/${s.web.project.id}/pages/${page.id}`,
    );

    const edited = await pageRow(page.id);
    expect(edited?.title).toBe("Login page specification");
    expect(edited?.contentMarkdown).toContain("Fast login.");
    expect(edited?.contentMarkdown).not.toContain("Old draft.");
    // The task link survives a replace that left it out.
    expect(edited?.contentMarkdown).toContain(`task-id="${task.id}"`);
    expect(edited?.updatedById).toBe(bot.userId);
    // Page history records the agent's edit like anyone's.
    const versions = await db
      .select()
      .from(pageVersionTable)
      .where(eq(pageVersionTable.pageId, page.id));
    expect(
      versions.some((version) => version.contributorIds.includes(bot.userId)),
    ).toBe(true);
    await settleAuditWrites();
    const audit = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.action, "agent.change_applied"));
    expect(audit).toHaveLength(1);

    await s.ok(s.mia, "POST", `/ai/agents/steps/${step?.id}/undo`, {
      workspaceId: s.workspaceId,
    });
    const restored = await pageRow(page.id);
    expect(restored?.title).toBe("Login spec");
    expect(restored?.contentMarkdown).toContain("Old draft.");
    expect(restored?.contentMarkdown).not.toContain("Fast login.");
  });

  it("refuses to undo once a person edited the page after the agent", async () => {
    const { s, bot, task, linkedPage } = await agentScene();
    const page = await linkedPage("Draft.");
    const result = await run(
      s,
      s.mia,
      bot.id,
      task.id,
      `Add risks ${marker("update_page", { page: page.id, mode: "append", content: "## Risks\n\nNone yet." })}`,
    );
    const [step] = toolSteps(result);
    expect(step?.change).toMatchObject({
      mode: "append",
      appended: "## Risks\n\nNone yet.",
    });
    const appended = await pageRow(page.id);
    expect(appended?.contentMarkdown).toContain("Draft.");
    expect(appended?.contentMarkdown).toContain("None yet.");

    await s.ok(s.ada, "PUT", `/page/${page.id}/content`, {
      markdown: `${appended?.contentMarkdown ?? ""}\n\nAda's note.`,
    });
    const undo = await s.as(s.mia)(
      "POST",
      `/ai/agents/steps/${step?.id}/undo`,
      { workspaceId: s.workspaceId },
    );
    expect(undo.status).toBe(409);
    expect(await undo.text()).toContain("edited after this change");
    expect((await pageRow(page.id))?.contentMarkdown).toContain("Ada's note.");
    const after = await s.ok<RunJson>(
      s.mia,
      "GET",
      `/ai/agents/runs/${result.id}?workspaceId=${s.workspaceId}`,
    );
    expect(toolSteps(after)[0]).toMatchObject({
      status: "applied",
      canUndo: true,
    });
  });

  it("needs page:update in the capped rights, and leaves private pages alone", async () => {
    const { s, bot, task, linkedPage } = await agentScene({ role: "viewer" });
    const page = await linkedPage("Draft.");
    const offered: string[][] = [];
    setFakeResponder((request: ChatRequest) => {
      offered.push((request.tools ?? []).map((tool) => tool.name));
      return null;
    });
    const denied = await run(
      s,
      s.mia,
      bot.id,
      task.id,
      `Edit ${marker("update_page", { page: page.id, content: "Hijacked." })}`,
    );
    expect(offered[0]).not.toContain("update_page");
    expect(toolSteps(denied)[0]).toMatchObject({
      toolName: "update_page",
      status: "denied",
      reason: "NOT_ALLOWED",
    });
    expect((await pageRow(page.id))?.contentMarkdown).toContain("Draft.");

    setFakeResponder(null);
    const member = await s.ok<AgentJson>(s.owner, "POST", "/ai/agents", {
      workspaceId: s.workspaceId,
      name: "Member Bot",
    });
    const mine = await linkedPage("Private notes.", { access: "private" });
    const refused = await run(
      s,
      s.mia,
      member.id,
      task.id,
      `Edit ${marker("update_page", { page: mine.id, content: "Changed." })}`,
    );
    expect(toolSteps(refused)[0]).toMatchObject({
      toolName: "update_page",
      status: "error",
    });
    expect((await pageRow(mine.id))?.contentMarkdown).toContain(
      "Private notes.",
    );
  });

  it("waits for approval when writes need it, and never overwrites a later edit", async () => {
    const { s, bot, task, linkedPage } = await agentScene();
    await saveWorkspaceAiSettings(
      s.workspaceId,
      { requireApprovalForWrites: true },
      s.owner.id,
    );
    const page = await linkedPage("Draft.");
    const held = await run(
      s,
      s.mia,
      bot.id,
      task.id,
      `Rewrite ${marker("update_page", { page: page.id, content: "Agent version." })}`,
    );
    expect(held.status).toBe("awaiting_approval");
    expect(toolSteps(held)[0]).toMatchObject({ status: "pending" });
    expect((await pageRow(page.id))?.contentMarkdown).toContain("Draft.");

    // Someone edits the page while the change waits: approving refuses.
    await s.ok(s.ada, "PUT", `/page/${page.id}/content`, {
      markdown: "Ada rewrote it.",
    });
    const [approval] = await s.ok<{ id: string }[]>(
      s.mia,
      "GET",
      `/ai/agents/approvals?workspaceId=${s.workspaceId}`,
    );
    const approve = await s.as(s.mia)(
      "POST",
      `/ai/agents/approvals/${approval?.id}/approve`,
      { workspaceId: s.workspaceId },
    );
    expect(approve.status).toBe(409);
    expect((await pageRow(page.id))?.contentMarkdown).toBe("Ada rewrote it.");

    // A fresh proposal on the current page applies once approved.
    await s.ok(s.mia, "POST", `/ai/agents/approvals/${approval?.id}/reject`, {
      workspaceId: s.workspaceId,
    });
    const again = await run(
      s,
      s.mia,
      bot.id,
      task.id,
      `Rewrite ${marker("update_page", { page: page.id, content: "Agent version." })}`,
    );
    const pending = toolSteps(again)[0];
    expect(pending?.status).toBe("pending");
    const approvals = await s.ok<{ id: string }[]>(
      s.mia,
      "GET",
      `/ai/agents/approvals?workspaceId=${s.workspaceId}`,
    );
    await s.ok(
      s.mia,
      "POST",
      `/ai/agents/approvals/${approvals[0]?.id}/approve`,
      { workspaceId: s.workspaceId },
    );
    expect((await pageRow(page.id))?.contentMarkdown).toContain(
      "Agent version.",
    );
  });
});

describe("spec writer", () => {
  const specWriter = AGENT_TEMPLATES.find((t) => t.id === "specWriter");

  /**
   * A model that follows its instructions: it revises a page listed as
   * linked to the task, and creates one only when none is listed. Its
   * comment and summary name the page by id, as the model in the field did.
   */
  function obedientModel(systems: string[]) {
    return (request: ChatRequest): FakeReply => {
      systems.push(JSON.stringify(request.system ?? ""));
      const opening = request.messages[0];
      const text = typeof opening?.content === "string" ? opening.content : "";
      const linked = /\(page id ([a-z0-9]+), link/.exec(text)?.[1];
      const turn = request.messages.filter(
        (m) => m.role === "assistant",
      ).length;
      const taskId = /The task you are working on \(id ([a-z0-9]+)\)/.exec(
        text,
      )?.[1];
      if (turn === 0) {
        return {
          toolCalls: [
            linked
              ? {
                  id: "c1",
                  name: "update_page",
                  input: { page: linked, content: "## Goals\n\nRevised." },
                }
              : {
                  id: "c1",
                  name: "create_page",
                  input: {
                    task: taskId,
                    title: "Login page specification",
                    content: "## Goals\n\nFirst draft.",
                  },
                },
          ],
        };
      }
      const pageId =
        linked ??
        /\/pages\/([a-z0-9]+)\)/.exec(JSON.stringify(request.messages))?.[1];
      if (turn === 1) {
        return {
          toolCalls: [
            {
              id: "c2",
              name: "add_comment",
              input: {
                task: taskId,
                body: `Spec written on page: "Login page specification" (task ${taskId}, page id ${pageId}).`,
              },
            },
          ],
        };
      }
      return { text: `Done: the spec is on page id ${pageId}.` };
    };
  }

  it("revises the task's page on the next run instead of creating a copy", async () => {
    const { s, bot, task, key } = await agentScene({
      instructions: specWriter?.instructions,
    });
    const systems: string[] = [];
    setFakeResponder(obedientModel(systems));

    const first = await run(s, s.mia, bot.id, task.id, "Write the spec.");
    expect(toolSteps(first).map((step) => step.toolName)).toEqual([
      "create_page",
      "add_comment",
    ]);
    expect(await projectPages(s.web.project.id)).toHaveLength(1);

    const second = await run(s, s.mia, bot.id, task.id, "Revise the spec.");
    expect(toolSteps(second).map((step) => step.toolName)).toEqual([
      "update_page",
      "add_comment",
    ]);
    const pages = await projectPages(s.web.project.id);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.contentMarkdown).toContain("Revised.");
    expect(pages[0]?.contentMarkdown).toContain(`task-id="${task.id}"`);

    // The rules the model got.
    expect(systems[0]).toContain("revise it with update_page");
    expect(systems[0]).toContain("Never show internal ids");
    expect(systems[0]).toContain("revise that page with update_page");

    // The comments people read name the task by key and link the page.
    const pagePath = `/dashboard/workspace/${s.workspaceId}/project/${s.web.project.id}/pages/${pages[0]?.id}`;
    const comments = await db
      .select({ content: activityTable.content })
      .from(activityTable)
      .where(
        and(
          eq(activityTable.taskId, task.id),
          eq(activityTable.type, "comment"),
        ),
      );
    expect(comments).toHaveLength(2);
    for (const comment of comments) {
      expect(comment.content).toBe(
        `Spec written on page: "Login page specification" (task ${key}).`,
      );
      expect(comment.content).not.toContain(task.id);
    }
    expect(second.outputSummary).toBe(
      `Done: the spec is on page [Login page specification](${pagePath}).`,
    );
  });
});
