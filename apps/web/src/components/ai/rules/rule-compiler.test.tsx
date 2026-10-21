import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RuleCompiler from "./rule-compiler";

const m = vi.hoisted(() => ({
  available: true,
  canUpdate: true,
  compile: vi.fn(),
  dryRun: vi.fn(),
  upsert: vi.fn(),
  updateAutomations: vi.fn(),
  success: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
    i18n: { language: "en-US", resolvedLanguage: "en-US" },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@/hooks/queries/ai/use-ai", () => ({
  useAiAvailability: () => ({ available: m.available }),
}));
vi.mock("@/components/editor/ai/use-editor-ai", () => ({
  useAiLocale: () => "en-US",
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateProjects: () => m.canUpdate,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" } }),
}));
vi.mock("@/hooks/queries/column/use-get-columns", () => ({
  useGetColumns: () => ({
    data: [
      { id: "c-todo", slug: "to-do", name: "To Do", group: "unstarted" },
      { id: "c-done", slug: "done", name: "Done", group: "completed" },
      { id: "c-wont", slug: "wont-do", name: "Won't do", group: "cancelled" },
    ],
  }),
}));
vi.mock("@/hooks/queries/project-automation/use-project-automations", () => ({
  useProjectAutomations: () => ({ data: undefined }),
}));
vi.mock("@/hooks/mutations/ai/use-ai-rules", async () => {
  const { useMutation } = await import("@tanstack/react-query");
  return {
    useCompileRule: () => useMutation({ mutationFn: m.compile }),
    useRuleDryRun: () => useMutation({ mutationFn: m.dryRun }),
  };
});
vi.mock("@/hooks/mutations/workflow-rule/use-upsert-workflow-rule", () => ({
  useUpsertWorkflowRule: () => ({ mutateAsync: m.upsert }),
}));
vi.mock(
  "@/hooks/mutations/project-automation/use-update-project-automations",
  () => ({
    useUpdateProjectAutomations: () => ({ mutateAsync: m.updateAutomations }),
  }),
);
vi.mock("@/lib/toast", () => ({
  toast: { success: m.success, error: vi.fn() },
}));

async function renderCompiler() {
  const { QueryClient, QueryClientProvider } = await import(
    "@tanstack/react-query"
  );
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RuleCompiler projectId="p1" />
    </QueryClientProvider>,
  );
}

function describeRule(text: string) {
  fireEvent.change(screen.getByLabelText("ai:rules.label"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: /ai:rules.compile/ }));
}

beforeEach(() => {
  m.available = true;
  m.canUpdate = true;
  m.compile.mockReset();
  m.dryRun.mockReset();
  m.upsert.mockReset();
  m.updateAutomations.mockReset();
  m.success.mockReset();
});

afterEach(cleanup);

describe("RuleCompiler", () => {
  it("stays hidden while AI is unavailable or the person can't manage automations", async () => {
    m.available = false;
    const first = await renderCompiler();
    expect(first.container.textContent).toBe("");
    cleanup();
    m.available = true;
    m.canUpdate = false;
    const second = await renderCompiler();
    expect(second.container.textContent).toBe("");
  });

  it("shows the compiled rule in the usual controls, replays and saves it", async () => {
    m.compile.mockResolvedValue({
      projectId: "p1",
      status: "partial",
      rules: [
        {
          engine: "workflow_rule",
          rule: {
            integrationType: "github",
            eventType: "pr_merged",
            columnId: "c-done",
          },
        },
      ],
      unsupported: [
        { request: "and notify Sam", reason: "Rules can't notify people." },
      ],
      rejected: 0,
    });
    m.dryRun.mockResolvedValue({
      projectId: "p1",
      projectSlug: "web",
      engine: "workflow_rule",
      days: 30,
      from: "2026-09-21T00:00:00.000Z",
      to: "2026-10-21T00:00:00.000Z",
      total: 1,
      changed: 1,
      capped: false,
      matches: [
        {
          taskId: "t1",
          taskNumber: 12,
          title: "Fix login",
          at: "2026-10-10T00:00:00.000Z",
          kind: "move",
          outcome: "change",
          from: "To Do",
          to: "Done",
        },
      ],
      notes: [],
    });
    m.upsert.mockResolvedValue({});
    await renderCompiler();

    describeRule("When a PR is merged move it to Done and notify Sam");
    await screen.findByText("ai:rules.workflowRule");
    expect(m.compile.mock.calls[0]?.[0]).toEqual({
      projectId: "p1",
      prompt: "When a PR is merged move it to Done and notify Sam",
      locale: "en-US",
    });
    expect(screen.getByText("and notify Sam")).toBeTruthy();
    expect(
      screen.getByText("settings:workflowEditor.events.pr_merged"),
    ).toBeTruthy();
    expect(screen.getAllByText("Done").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /ai:rules.dryRun/ }));
    await screen.findByText("Fix login");
    expect(screen.getByText("WEB-12")).toBeTruthy();
    expect(m.dryRun.mock.calls[0]?.[0]).toMatchObject({
      projectId: "p1",
      days: 30,
      rule: { engine: "workflow_rule" },
    });

    fireEvent.click(screen.getByRole("button", { name: "ai:rules.save" }));
    await waitFor(() =>
      expect(m.upsert).toHaveBeenCalledWith({
        projectId: "p1",
        data: {
          integrationType: "github",
          eventType: "pr_merged",
          columnId: "c-done",
        },
      }),
    );
    await waitFor(() =>
      expect(m.success).toHaveBeenCalledWith("ai:rules.saved"),
    );
    expect(screen.queryByText("ai:rules.workflowRule")).toBeNull();
  });

  it("saves a scheduled automation through the automations route", async () => {
    m.compile.mockResolvedValue({
      projectId: "p1",
      status: "compiled",
      rules: [
        {
          engine: "project_automation",
          patch: { autoArchive: { enabled: true, months: 2 } },
        },
      ],
      unsupported: [],
      rejected: 0,
    });
    m.updateAutomations.mockResolvedValue({});
    await renderCompiler();
    describeRule("Archive closed tasks after two months");
    await screen.findByText("settings:projectAutomations.autoArchive.title");
    fireEvent.click(screen.getByRole("button", { name: "ai:rules.save" }));
    await waitFor(() =>
      expect(m.updateAutomations).toHaveBeenCalledWith({
        workspaceId: "w1",
        projectId: "p1",
        patch: { autoArchive: { enabled: true, months: 2 } },
      }),
    );
  });

  it("says when nothing could be compiled", async () => {
    m.compile.mockResolvedValue({
      projectId: "p1",
      status: "unsupported",
      rules: [],
      unsupported: [
        {
          request: "assign it to Priya",
          reason: "Rules can't assign people.",
        },
      ],
      rejected: 1,
    });
    await renderCompiler();
    describeRule("When a bug moves to In review assign it to Priya");
    await screen.findByText("ai:rules.noRules");
    expect(screen.getByText("assign it to Priya")).toBeTruthy();
    expect(screen.getByText('ai:rules.rejected {"rejected":1}')).toBeTruthy();
    expect(screen.queryByRole("button", { name: "ai:rules.save" })).toBeNull();
  });
});
