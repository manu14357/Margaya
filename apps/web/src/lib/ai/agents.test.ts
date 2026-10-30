import { describe, expect, it } from "vitest";
import { arrangeActivities } from "@/components/activity/activity-feed-options";
import { withoutAgents } from "@/components/ai/agents/use-agent-ids";
import { agentViaOf, changeDiff, runErrorKey } from "./agents";

const labels = {
  priority: (value: string) => `P:${value}`,
  status: (value: string) => `S:${value}`,
};

describe("changeDiff", () => {
  it("shows each changed field of a task update, before and after", () => {
    const diff = changeDiff(
      {
        op: "update_task",
        taskLabel: "WEB-1 Fix login",
        before: { priority: "low", title: "Old" },
        after: { priority: "high", title: "New" },
      },
      labels,
    );
    expect(diff.taskLabel).toBe("WEB-1 Fix login");
    expect(diff.lines).toEqual([
      {
        labelKey: "ai:agents.change.fields.priority",
        before: "P:low",
        after: "P:high",
      },
      {
        labelKey: "ai:agents.change.fields.title",
        before: "Old",
        after: "New",
      },
    ]);
  });

  it("lists every task of a bulk move and nothing for unknown ops", () => {
    const diff = changeDiff(
      {
        op: "bulk_set_status",
        items: [
          { taskLabel: "A", before: "to-do", after: "done" },
          { taskLabel: "B", before: "in-progress", after: "done" },
        ],
      },
      labels,
    );
    expect(diff.lines.map((line) => line.labelValues)).toEqual([
      { task: "A" },
      { task: "B" },
    ]);
    expect(diff.lines[1]).toMatchObject({
      before: "S:in-progress",
      after: "S:done",
    });
    expect(changeDiff({ op: "something_new" }, labels).lines).toEqual([]);
    expect(changeDiff(null, labels).lines).toEqual([]);
  });

  it("shows a comment as an addition only", () => {
    expect(
      changeDiff({ op: "comment", content: "On it" }, labels).lines,
    ).toEqual([
      {
        labelKey: "ai:agents.change.fields.comment",
        before: null,
        after: "On it",
      },
    ]);
  });

  it("shows a page edit: a renamed title and the new content or added section", () => {
    const replaced = changeDiff(
      {
        op: "update_page",
        taskLabel: "Login spec",
        mode: "replace",
        before: { title: "Login spec", content: "Old" },
        after: { title: "Login page specification", content: "New" },
      },
      labels,
    );
    expect(replaced.taskLabel).toBe("Login spec");
    expect(replaced.lines).toEqual([
      {
        labelKey: "ai:agents.change.fields.title",
        before: "Login spec",
        after: "Login page specification",
      },
      {
        labelKey: "ai:agents.change.fields.pageContent",
        before: null,
        after: "New",
      },
    ]);
    const appended = changeDiff(
      {
        op: "update_page",
        taskLabel: "Login spec",
        mode: "append",
        before: { content: "Old" },
        after: { content: "Old\n\n## Risks" },
        appended: "## Risks",
      },
      labels,
    );
    expect(appended.lines).toEqual([
      {
        labelKey: "ai:agents.change.fields.pageSection",
        before: null,
        after: "## Risks",
      },
    ]);
  });
});

describe("agent attribution", () => {
  it("reads the via block of an agent's activity", () => {
    const via = {
      agentId: "a",
      agentUserId: "u",
      agentName: "Bot",
      onBehalfOf: "p",
      onBehalfOfName: "Mia",
      runId: "r",
    };
    expect(agentViaOf({ via, newStatus: "done" })).toEqual(via);
    expect(agentViaOf({ newStatus: "done" })).toBeNull();
    expect(agentViaOf(null)).toBeNull();
  });

  it("filters the activity feed to agent work", () => {
    const items = [
      { type: "comment", content: "hi", createdAt: "2026-01-01T00:00:00Z" },
      {
        type: "status_changed",
        content: null,
        createdAt: "2026-01-02T00:00:00Z",
        eventData: { via: { agentName: "Bot", runId: "r" } },
      },
    ];
    expect(
      arrangeActivities(items, "agents", "newest").map((item) => item.type),
    ).toEqual(["status_changed"]);
  });

  it("keeps agents out of people-only lists", () => {
    const members = [{ userId: "human" }, { userId: "bot" }];
    expect(withoutAgents(members, new Set(["bot"]), (m) => m.userId)).toEqual([
      { userId: "human" },
    ]);
    expect(
      withoutAgents(undefined, new Set(), (m: { userId: string }) => m.userId),
    ).toEqual([]);
  });
});

describe("runErrorKey", () => {
  it("maps gateway codes to AI errors and run codes to agent errors", () => {
    expect(runErrorKey("AI_BUDGET_EXCEEDED")).toBe(
      "ai:errors.AI_BUDGET_EXCEEDED",
    );
    expect(runErrorKey("PRINCIPAL_LEFT")).toBe(
      "ai:agents.runErrors.PRINCIPAL_LEFT",
    );
    expect(runErrorKey("WHATEVER")).toBe("ai:agents.runErrors.INTERNAL");
    expect(runErrorKey(null)).toBeNull();
  });
});
