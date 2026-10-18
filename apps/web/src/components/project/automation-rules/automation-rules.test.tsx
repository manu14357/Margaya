import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AutomationRules from "./automation-rules";
import {
  draftComplete,
  draftToInput,
  emptyDraft,
  templateDraft,
} from "./rule-model";

const m = vi.hoisted(() => ({
  canUpdate: true,
  rules: [] as Array<Record<string, unknown>>,
  update: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: "en-US" },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateProjects: () => m.canUpdate,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/hooks/queries/automation-rule/use-automation-rules", () => ({
  useAutomationRules: () => ({
    data: { rules: m.rules },
    isLoading: false,
    isError: false,
  }),
  useAutomationRuns: () => ({
    data: {
      runs: [
        {
          id: "run1",
          ruleId: "r1",
          ruleName: "Reviewer",
          taskId: "t1",
          taskKey: "WEB-1",
          taskTitle: "Crash",
          triggerType: "status_changed",
          outcome: "skipped",
          error: "LOOP_DEPTH",
          actions: [],
          depth: 3,
          createdAt: new Date().toISOString(),
        },
      ],
    },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock(
  "@/hooks/mutations/automation-rule/use-automation-rule-mutations",
  () => ({
    useCreateAutomationRule: () => ({
      mutateAsync: m.create,
      isPending: false,
    }),
    useUpdateAutomationRule: () => ({
      mutate: m.update,
      mutateAsync: m.update,
      isPending: false,
    }),
    useDeleteAutomationRule: () => ({ mutate: m.remove }),
  }),
);
vi.mock("./use-rule-options", () => ({
  useRuleOptions: () => ({
    columns: [
      { id: "c-todo", name: "To do", slug: "to-do" },
      { id: "c-review", name: "In review", slug: "in-review" },
    ],
    people: [{ id: "u1", name: "Priya" }],
    labels: ["bug"],
    cycles: [],
    modules: [],
    fields: [],
  }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const rule = {
  id: "r1",
  projectId: "p1",
  name: "Reviewer",
  enabled: true,
  trigger: { type: "status_changed", to: ["c-review"] },
  conditions: null,
  actions: [{ type: "assign", userIds: ["u1"] }],
  createdBy: "u0",
  runCount: 2,
  failureCount: 0,
  lastRunAt: new Date().toISOString(),
  lastOutcome: "success",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

beforeEach(() => {
  m.canUpdate = true;
  m.rules = [rule];
  m.update.mockReset();
  m.create.mockReset();
  m.remove.mockReset();
});
afterEach(cleanup);

const K = "settings:automationRules";

describe("AutomationRules", () => {
  it("lists rules and toggles one off", () => {
    render(<AutomationRules projectId="p1" />);
    expect(screen.getByText("Reviewer")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch"));
    expect(m.update).toHaveBeenCalledWith(
      { ruleId: "r1", patch: { enabled: false } },
      expect.anything(),
    );
  });

  it("starts a template in the When / If / Then builder", () => {
    render(<AutomationRules projectId="p1" />);
    fireEvent.click(screen.getByText(`${K}.templates.reviewer.name`));
    expect(screen.getByText(`${K}.editor.when`)).toBeTruthy();
    expect(screen.getByText(`${K}.editor.if`)).toBeTruthy();
    expect(screen.getByText(`${K}.editor.then`)).toBeTruthy();
    const save = screen.getByRole("button", { name: `${K}.editor.save` });
    // The template leaves the reviewer to pick: not saveable yet.
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });

  it("is read-only without project:update", () => {
    m.canUpdate = false;
    render(<AutomationRules projectId="p1" />);
    expect(screen.queryByText(`${K}.newRule`)).toBeNull();
    expect(
      (screen.getByRole("switch") as HTMLButtonElement).getAttribute(
        "aria-disabled",
      ) === "true" ||
        (screen.getByRole("switch") as HTMLButtonElement).hasAttribute(
          "data-disabled",
        ),
    ).toBe(true);
  });

  it("shows run outcomes with the loop guard reason", () => {
    render(<AutomationRules projectId="p1" />);
    fireEvent.click(screen.getByText(`${K}.history.title`));
    expect(screen.getByText(`${K}.outcomes.skipped`)).toBeTruthy();
    expect(screen.getByText(`${K}.errors.LOOP_DEPTH`)).toBeTruthy();
  });
});

describe("rule model", () => {
  it("needs a name and complete actions", () => {
    const draft = emptyDraft();
    expect(draftComplete(draft)).toBe(false);
    expect(
      draftComplete({
        ...draft,
        name: "Assign",
        actions: [{ type: "assign", userIds: ["u1"] }],
      }),
    ).toBe(true);
  });

  it("drops empty condition groups when saving", () => {
    const input = draftToInput({
      ...emptyDraft(),
      name: " Rule ",
      conditions: { op: "and", conditions: [] },
    });
    expect(input.name).toBe("Rule");
    expect(input.conditions).toBeNull();
  });

  it("points the reviewer template at the review column", () => {
    const draft = templateDraft("reviewer", {
      name: "Reviewer",
      columns: [
        { id: "c-todo", name: "To do", slug: "to-do" },
        { id: "c-review", name: "In review", slug: "in-review" },
      ],
    });
    expect(draft.trigger).toEqual({ type: "status_changed", to: ["c-review"] });
    expect(
      templateDraft("intakeBugs", { name: "x", columns: [] }).trigger,
    ).toEqual({
      type: "task_created",
      fromIntake: true,
    });
  });
});
