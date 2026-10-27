import { describe, expect, it } from "vitest";
import {
  canFollowUp,
  changeDiff,
  RUN_STATUSES,
  runErrorKey,
  TRIGGER_KEYS,
  toolLabel,
  workedFor,
} from "./agents";

const labels = {
  priority: (value: string) => value,
  status: (value: string) => value,
};
const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key} ${JSON.stringify(options)}` : key;

describe("agent runs in the Agent Desk", () => {
  it("says how long a run worked, in seconds then minutes", () => {
    expect(
      workedFor("2026-10-27T10:00:00.000Z", "2026-10-27T10:00:42.400Z"),
    ).toEqual({ key: "ai:agents.desk.workedSeconds", values: { count: 42 } });
    expect(
      workedFor("2026-10-27T10:00:00.000Z", "2026-10-27T10:03:20.000Z"),
    ).toEqual({ key: "ai:agents.desk.workedMinutes", values: { count: 3 } });
    expect(workedFor("2026-10-27T10:00:00.000Z", null)).toBeNull();
    expect(workedFor(null, "2026-10-27T10:00:00.000Z")).toBeNull();
  });

  it("knows the needs-input status and the new triggers", () => {
    expect(RUN_STATUSES).toContain("needs_input");
    expect(TRIGGER_KEYS.schedule).toBe("ai:agents.desk.trigger.schedule");
    expect(TRIGGER_KEYS.automation).toBe("ai:agents.desk.trigger.automation");
    expect(TRIGGER_KEYS.chat).toBe("ai:agents.desk.trigger.chat");
    expect(runErrorKey("NEEDS_INPUT_EXPIRED")).toBe(
      "ai:agents.runErrors.NEEDS_INPUT_EXPIRED",
    );
    expect(runErrorKey("OUTSIDE_AGENT_PROJECTS")).toBe(
      "ai:agents.runErrors.OUTSIDE_AGENT_PROJECTS",
    );
  });

  it("follows up only on runs that ended", () => {
    expect(canFollowUp("succeeded")).toBe(true);
    expect(canFollowUp("failed")).toBe(true);
    expect(canFollowUp("needs_input")).toBe(false);
    expect(canFollowUp("running")).toBe(false);
  });

  it("labels questions, web search and connector tools", () => {
    expect(toolLabel(t, "ask_person")).toBe("ai:agents.tools.ask_person");
    expect(toolLabel(t, "web_search")).toBe("ai:agents.tools.web_search");
    expect(toolLabel(t, "connector_acme_issues__create_issue")).toBe(
      'ai:agents.tools.connector {"tool":"create_issue"}',
    );
    expect(toolLabel(t, "mystery")).toBe("mystery");
  });

  it("previews a call to an outside service", () => {
    const diff = changeDiff(
      {
        op: "connector_call",
        connectorName: "Acme",
        tool: "create_issue",
        args: { title: "Crash" },
      },
      labels,
    );
    expect(diff.lines).toEqual([
      {
        labelKey: "ai:agents.change.fields.connectorCall",
        labelValues: { connector: "Acme" },
        before: null,
        after: 'create_issue {"title":"Crash"}',
      },
    ]);
  });

  it("previews a project page without a task", () => {
    const diff = changeDiff(
      { op: "create_page", taskId: null, taskLabel: "Web", title: "Standup" },
      labels,
    );
    expect(diff.taskLabel).toBe("Web");
    expect(diff.lines[0]?.after).toBe("Standup");
  });
});
