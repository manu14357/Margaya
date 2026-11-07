import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkflowEditor from "./workflow-editor";

const mocks = vi.hoisted(() => ({
  rules: vi.fn(),
  deleteRule: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { event?: string }) =>
      options?.event ? `${key}:${options.event}` : key,
  }),
}));
vi.mock("@/hooks/queries/column/use-get-columns", () => ({
  useGetColumns: () => ({
    data: [{ id: "col-done", name: "Done" }],
    isLoading: false,
  }),
}));
vi.mock("@/hooks/queries/workflow-rule/use-get-workflow-rules", () => ({
  useGetWorkflowRules: () => ({ data: mocks.rules(), isLoading: false }),
}));
vi.mock("@/hooks/mutations/workflow-rule/use-upsert-workflow-rule", () => ({
  useUpsertWorkflowRule: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/mutations/workflow-rule/use-delete-workflow-rule", () => ({
  useDeleteWorkflowRule: () => ({
    mutateAsync: mocks.deleteRule,
    isPending: false,
  }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));

const REMOVE_MERGED =
  "settings:workflowEditor.removeRule:settings:workflowEditor.events.pr_merged";

const RULE = {
  id: "rule-1",
  integrationType: "github",
  eventType: "pr_merged",
  columnId: "col-done",
};

describe("WorkflowEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteRule.mockResolvedValue(RULE);
  });
  afterEach(cleanup);

  it("offers removal only for the events that have a rule", () => {
    mocks.rules.mockReturnValue([RULE]);
    render(<WorkflowEditor projectId="p-1" />);
    expect(screen.getAllByRole("button", { name: /removeRule/ })).toHaveLength(
      1,
    );
    expect(screen.getByRole("button", { name: REMOVE_MERGED })).toBeTruthy();
  });

  it("shows nothing to remove without rules", () => {
    mocks.rules.mockReturnValue([]);
    render(<WorkflowEditor projectId="p-1" />);
    expect(screen.queryByRole("button", { name: /removeRule/ })).toBeNull();
  });

  it("deletes the rule of that event and says so", async () => {
    mocks.rules.mockReturnValue([RULE]);
    render(<WorkflowEditor projectId="p-1" />);
    fireEvent.click(screen.getByRole("button", { name: REMOVE_MERGED }));
    await vi.waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith(
        "settings:workflowEditor.toastRemoved",
      ),
    );
    expect(mocks.deleteRule).toHaveBeenCalledWith({
      id: "rule-1",
      projectId: "p-1",
    });
  });

  it("reports a failed removal", async () => {
    mocks.rules.mockReturnValue([RULE]);
    mocks.deleteRule.mockRejectedValue(new Error("Not allowed"));
    render(<WorkflowEditor projectId="p-1" />);
    fireEvent.click(screen.getByRole("button", { name: REMOVE_MERGED }));
    await vi.waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith("Not allowed"),
    );
    expect(mocks.success).not.toHaveBeenCalled();
  });
});
