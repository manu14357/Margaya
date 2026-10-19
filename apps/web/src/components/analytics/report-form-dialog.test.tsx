import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import type {
  AnalyticsReport,
  AnalyticsReportConfig,
} from "@/types/analytics-report";
import ReportFormDialog, { reportErrorMessage } from "./report-form-dialog";

const m = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: m.toastError },
}));
vi.mock(
  "@/hooks/mutations/analytics-report/use-analytics-report-mutations",
  () => ({
    useCreateAnalyticsReport: () => ({ mutate: m.create, isPending: false }),
    useUpdateAnalyticsReport: () => ({ mutate: m.update, isPending: false }),
  }),
);

const config: AnalyticsReportConfig = {
  scope: { projectIds: ["p1"] },
  filters: null,
  archived: "exclude",
  xAxis: "assignee",
};

const report = {
  id: "r1",
  workspaceId: "ws-1",
  name: "Open bugs",
  visibility: "workspace",
  owner: { id: "u1", name: "Ada" },
  isOwner: true,
  canDelete: true,
  config,
  droppedProjectCount: 0,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
} as AnalyticsReport;

const nameInput = () => screen.getByLabelText("analytics:reports.dialog.name");

describe("ReportFormDialog", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("saves the configuration with the name and visibility", () => {
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    m.create.mockImplementation((_input, options) =>
      options.onSuccess({ ...report, visibility: "private" }),
    );
    render(
      <ReportFormDialog
        open
        onOpenChange={onOpenChange}
        workspaceId="ws-1"
        config={config}
        onSaved={onSaved}
      />,
    );
    expect(
      screen.getByText("analytics:reports.dialog.summary"),
    ).toBeInTheDocument();
    fireEvent.change(nameInput(), { target: { value: "  Bugs by person " } });
    fireEvent.click(
      screen.getByRole("button", { name: "analytics:reports.dialog.save" }),
    );
    expect(m.create).toHaveBeenCalledWith(
      {
        workspaceId: "ws-1",
        name: "Bugs by person",
        visibility: "private",
        config,
      },
      expect.any(Object),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSaved).toHaveBeenCalled();
  });

  it("asks for a name before saving", () => {
    render(
      <ReportFormDialog
        open
        onOpenChange={vi.fn()}
        workspaceId="ws-1"
        config={config}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "analytics:reports.dialog.save" }),
    );
    expect(
      screen.getByText("analytics:reports.dialog.nameRequired"),
    ).toBeInTheDocument();
    expect(m.create).not.toHaveBeenCalled();
  });

  it("renames a report and keeps its visibility", () => {
    render(
      <ReportFormDialog
        open
        onOpenChange={vi.fn()}
        workspaceId="ws-1"
        report={report}
      />,
    );
    expect(nameInput()).toHaveValue("Open bugs");
    fireEvent.change(nameInput(), { target: { value: "Bugs" } });
    fireEvent.click(
      screen.getByRole("button", { name: "analytics:reports.dialog.update" }),
    );
    expect(m.update).toHaveBeenCalledWith(
      { id: "r1", changes: { name: "Bugs", visibility: "workspace" } },
      expect.any(Object),
    );
    expect(m.create).not.toHaveBeenCalled();
  });

  it("shows the API's message for a refused save", () => {
    m.create.mockImplementation((_input, options) =>
      options.onError(new HttpError(400, "You already have 100 reports")),
    );
    render(
      <ReportFormDialog
        open
        onOpenChange={vi.fn()}
        workspaceId="ws-1"
        config={config}
      />,
    );
    fireEvent.change(nameInput(), { target: { value: "One more" } });
    fireEvent.click(
      screen.getByRole("button", { name: "analytics:reports.dialog.save" }),
    );
    expect(m.toastError).toHaveBeenCalledWith("You already have 100 reports");
  });
});

describe("reportErrorMessage", () => {
  it("passes client errors and hides server ones", () => {
    expect(reportErrorMessage(new HttpError(404, "Not found"))).toBe(
      "Not found",
    );
    expect(reportErrorMessage(new HttpError(500, "boom"))).toBeNull();
    expect(reportErrorMessage(new HttpError(400, '{"error":1}'))).toBeNull();
    expect(reportErrorMessage(new Error("x"))).toBeNull();
  });
});
