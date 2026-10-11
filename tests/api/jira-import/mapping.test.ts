import { describe, expect, it } from "vitest";
import type { JiraIssue } from "../../../apps/api/src/jira-import/issues";
import {
  createMemberMatcher,
  type ImportColumn,
  suggestPriority,
  suggestStatus,
} from "../../../apps/api/src/jira-import/mapping";
import {
  attachmentNote,
  type PlanContext,
  planIssue,
  planRelations,
} from "../../../apps/api/src/jira-import/plan";
import { jiraImportOptions } from "../../../apps/api/src/jira-import/schema";
import { WarningLog } from "../../../apps/api/src/jira-import/warnings";

const COLUMNS: ImportColumn[] = [
  { slug: "backlog", name: "Backlog", group: "backlog" },
  { slug: "to-do", name: "To Do", group: "unstarted" },
  { slug: "in-progress", name: "In Progress", group: "started" },
  { slug: "done", name: "Done", group: "completed" },
];

function issue(overrides: Partial<JiraIssue> = {}): JiraIssue {
  return {
    line: 2,
    key: "WEB-1",
    id: "10001",
    summary: "Title",
    description: "",
    issueType: "Bug",
    status: "To Do",
    statusCategory: "To Do",
    priority: "High",
    assignee: "",
    reporter: "",
    labels: [],
    created: null,
    updated: null,
    resolved: null,
    dueDate: null,
    badDates: [],
    storyPoints: null,
    originalEstimateSeconds: null,
    parent: "",
    links: [],
    comments: [],
    sprints: [],
    components: [],
    attachments: [],
    ...overrides,
  };
}

function context(overrides: Partial<PlanContext> = {}): PlanContext {
  return {
    columns: COLUMNS,
    options: jiraImportOptions.parse({}),
    matchMember: () => null,
    estimate: { enabled: false, reads: null, pointFor: () => null },
    cyclesOn: true,
    modulesOn: true,
    commentsAllowed: true,
    ...overrides,
  };
}

describe("Jira status and priority suggestions", () => {
  it.each([
    ["In Progress", "In Progress", "in-progress"],
    ["in progress", "", "in-progress"],
    ["Code Review", "In Progress", "in-progress"],
    ["Selected for Development", "To Do", "to-do"],
    ["Closed", "", "done"],
    ["Awaiting Spec", "To Do", "to-do"],
    ["Verifying", "Done", "done"],
    ["Mystery", "", "planned"],
  ])("%s (%s) → %s", (status, category, expected) => {
    expect(suggestStatus(status, category, COLUMNS)).toBe(expected);
  });

  it("falls back across groups the board lacks", () => {
    const noUnstarted = COLUMNS.filter(
      (column) => column.group !== "unstarted",
    );
    expect(suggestStatus("Open", "To Do", noUnstarted)).toBe("backlog");
    expect(suggestStatus("Won't Do", "Done", COLUMNS)).toBe("done");
  });

  it.each([
    ["Highest", "urgent"],
    ["High", "high"],
    ["Medium", "medium"],
    ["Low", "low"],
    ["Lowest", "low"],
    ["Blocker", "urgent"],
    ["", "no-priority"],
    ["Custom", "no-priority"],
  ])("%s → %s", (priority, expected) => {
    expect(suggestPriority(priority)).toBe(expected);
  });
});

describe("Jira people matching", () => {
  const match = createMemberMatcher([
    { id: "u1", name: "Ada Lovelace", email: "ada@example.com" },
    { id: "u2", name: "Sam Smith", email: "sam1@example.com" },
    { id: "u3", name: "Sam Smith", email: "sam2@example.com" },
  ]);

  it("matches by email, then by unique name, case-insensitively", () => {
    expect(match("ADA@example.com")?.id).toBe("u1");
    expect(match("ada  lovelace")?.id).toBe("u1");
    expect(match("Ada <ada@example.com>")?.id).toBe("u1");
    expect(match("sam2@example.com")?.id).toBe("u3");
  });

  it("leaves ambiguous and unknown people unmatched", () => {
    expect(match("Sam Smith")).toBeNull();
    expect(match("Grace Hopper")).toBeNull();
    expect(match("")).toBeNull();
  });
});

describe("planning one issue", () => {
  it("maps fields with the chosen status and priority", () => {
    const warnings = new WarningLog();
    const planned = planIssue(
      issue({
        description: "h2. Why\n*now*",
        labels: ["auth"],
        assignee: "ada@example.com",
        reporter: "Nobody",
      }),
      context({
        options: jiraImportOptions.parse({
          statusMap: { "To Do": "backlog" },
          priorityMap: { High: "urgent" },
        }),
        matchMember: (value) =>
          value === "ada@example.com"
            ? { id: "u1", name: "Ada", email: value }
            : null,
      }),
      warnings,
    );
    expect(planned).toMatchObject({
      title: "Title",
      description: "## Why\n**now**",
      status: "backlog",
      priority: "urgent",
      assigneeId: "u1",
      reporterId: null,
      labels: ["auth", "Bug"],
    });
    expect(warnings.list()).toEqual([]);
  });

  it("leaves the issue type out when the toggle is off", () => {
    const planned = planIssue(
      issue({ labels: ["x"] }),
      context({
        options: jiraImportOptions.parse({ issueTypeAsLabel: false }),
      }),
      new WarningLog(),
    );
    expect(planned.labels).toEqual(["x"]);
  });

  it("lists attachments in the description instead of downloading them", () => {
    const withFiles = issue({
      description: "Body",
      attachments: [
        { name: "log [1].txt", url: "https://jira.test/secure/1/log.txt" },
        { name: "notes.md", url: null },
      ],
    });
    const warnings = new WarningLog();
    const planned = planIssue(withFiles, context(), warnings);
    expect(planned.description).toBe(`Body\n\n${attachmentNote(withFiles)}`);
    expect(attachmentNote(withFiles)).toBe(
      "**Attachments in Jira (not imported)**\n\n- [log \\[1\\].txt](https://jira.test/secure/1/log.txt)\n- notes.md",
    );
    expect(warnings.list()).toHaveLength(1);
  });

  it("skips sprints, components, estimates and comments with a reason", () => {
    const warnings = new WarningLog();
    const planned = planIssue(
      issue({
        sprints: ["S1", "S2"],
        components: ["API"],
        storyPoints: 3,
        comments: [{ hash: "h", createdAt: null, author: "ada", body: "*hi*" }],
      }),
      context({
        options: jiraImportOptions.parse({
          sprintsAsCycles: true,
          componentsAsModules: true,
        }),
        cyclesOn: false,
        modulesOn: false,
        commentsAllowed: false,
      }),
      warnings,
    );
    expect(planned).toMatchObject({
      cycleName: null,
      moduleNames: [],
      estimatePointId: null,
      comments: [],
    });
    expect(warnings.list().map((warning) => warning.message)).toEqual([
      "Sprints skipped: cycles are turned off for this project",
      "Components skipped: modules are turned off for this project",
      "Comments skipped: importing comment authors needs the Manage workspace settings permission",
      "Estimates skipped: the project's Estimates feature is off",
    ]);
  });

  it("takes the last sprint, the components and matching estimates", () => {
    const warnings = new WarningLog();
    const planned = planIssue(
      issue({
        sprints: ["S1", "S2"],
        components: ["API", "API", "Web"],
        storyPoints: 5,
        comments: [{ hash: "h", createdAt: null, author: "", body: "*hi*" }],
      }),
      context({
        options: jiraImportOptions.parse({
          sprintsAsCycles: true,
          componentsAsModules: true,
        }),
        estimate: {
          enabled: true,
          reads: "points",
          pointFor: (value) => (value.storyPoints === 5 ? "p5" : null),
        },
      }),
      warnings,
    );
    expect(planned).toMatchObject({
      cycleName: "S2",
      moduleNames: ["API", "Web"],
      estimatePointId: "p5",
      comments: [
        { hash: "h", createdAt: null, author: "Jira user", content: "**hi**" },
      ],
    });
    expect(warnings.list()).toEqual([]);
  });
});

describe("planning relations", () => {
  it("links sub-tasks by parent id or key and dedups both link sides", () => {
    const relations = planRelations([
      issue({
        key: "A-1",
        id: "1",
        links: [
          { kind: "blocks", direction: "outward", key: "A-2" },
          { kind: "related", direction: "outward", key: "A-3" },
          { kind: "blocks", direction: "outward", key: "OTHER-9" },
        ],
      }),
      issue({
        key: "A-2",
        id: "2",
        parent: "1",
        links: [{ kind: "blocks", direction: "inward", key: "A-1" }],
      }),
      issue({
        key: "A-3",
        id: "3",
        parent: "A-1",
        links: [
          { kind: "related", direction: "outward", key: "A-1" },
          { kind: "duplicate", direction: "inward", key: "A-2" },
        ],
      }),
    ]);
    expect(relations).toEqual([
      { sourceKey: "A-1", targetKey: "A-2", relationType: "subtask" },
      { sourceKey: "A-1", targetKey: "A-3", relationType: "subtask" },
      { sourceKey: "A-1", targetKey: "A-2", relationType: "blocks" },
      { sourceKey: "A-1", targetKey: "A-3", relationType: "related" },
      { sourceKey: "A-2", targetKey: "A-3", relationType: "duplicate" },
    ]);
  });
});
