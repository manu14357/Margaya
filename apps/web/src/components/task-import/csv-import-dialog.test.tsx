import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BatchImportResult } from "@/lib/task-import/batch";
import { CsvImportDialog } from "./csv-import-dialog";

const m = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  toastError: vi.fn(),
}));

// Interpolation values are appended so assertions can see them.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: m.toastError },
}));
vi.mock("@/hooks/mutations/task/use-import-tasks", () => ({
  default: () => ({ mutateAsync: m.mutateAsync }),
}));
vi.mock("@/hooks/queries/task-import/use-csv-import-context", () => ({
  default: () => ({
    fields: [
      "title",
      "description",
      "status",
      "priority",
      "assignees",
      "labels",
      "startDate",
      "dueDate",
    ],
    context: {
      columns: [{ slug: "done", name: "Done" }],
      members: [],
      labels: [],
      cycles: [],
      modules: [],
      estimatePoints: [],
    },
    isLoading: false,
  }),
}));

const project = {
  id: "p-1",
  workspaceId: "ws-1",
  columns: [{ slug: "done", name: "Done", group: "completed" }],
};

function csv(content: string, name = "tasks.csv") {
  return new File([content], name, { type: "text/csv" });
}

function outcome(
  overrides: Partial<BatchImportResult> = {},
): BatchImportResult {
  return {
    total: 2,
    successful: 2,
    failed: 0,
    notSent: 0,
    issues: [],
    error: null,
    ...overrides,
  };
}

function button(name: string) {
  return screen.getByRole("button", {
    name: `settings:tasksImportExport.csv.${name}`,
  });
}

async function renderWithFile(content: string) {
  render(
    <CsvImportDialog
      open
      onOpenChange={vi.fn()}
      project={project}
      initialFile={csv(content)}
    />,
  );
  await screen.findByText("tasks.csv");
}

describe("CsvImportDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it("walks from upload through mapping and review to the result", async () => {
    m.mutateAsync.mockResolvedValue(outcome());
    await renderWithFile("Title,Status\nFirst,Done\n,orphan\nSecond,Blocked\n");

    expect(
      screen.getByText('settings:tasksImportExport.csv.rowCount {"count":3}'),
    ).toBeInTheDocument();
    fireEvent.click(button("next"));

    expect(
      screen.getByRole("combobox", {
        name: "settings:tasksImportExport.csv.fields.title",
      }),
    ).toHaveTextContent("Title");
    fireEvent.click(button("next"));

    expect(
      screen.getByText(
        'settings:tasksImportExport.csv.review.willImport {"count":2}',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'settings:tasksImportExport.csv.review.skipped {"count":1}',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'settings:tasksImportExport.csv.review.unmatchedStatus {"count":1}',
      ),
    ).toBeInTheDocument();

    fireEvent.click(button("import"));

    expect(
      await screen.findByText(
        'settings:tasksImportExport.csv.result.imported {"count":2}',
      ),
    ).toBeInTheDocument();
    expect(m.mutateAsync).toHaveBeenCalledWith({
      projectId: "p-1",
      tasks: [
        { title: "First", status: "Done" },
        { title: "Second", status: "Blocked" },
      ],
      batchSize: 200,
      onProgress: expect.any(Function),
    });
  });

  it("goes back from mapping to upload", async () => {
    await renderWithFile("Title\nA");
    fireEvent.click(button("next"));
    fireEvent.click(button("back"));

    expect(
      screen.getByText("settings:tasksImportExport.csv.hasHeader"),
    ).toBeInTheDocument();
  });

  it("keeps Next disabled until Title is mapped", async () => {
    await renderWithFile("Subject,Notes\nFix login,Soon");
    fireEvent.click(button("next"));
    expect(button("next")).not.toBeDisabled();

    const titleSelect = screen.getByRole("combobox", {
      name: "settings:tasksImportExport.csv.fields.title",
    });
    fireEvent.click(titleSelect);
    const dontImport = await screen.findByRole("option", {
      name: "settings:tasksImportExport.csv.dontImport",
    });
    fireEvent.pointerDown(dontImport, { pointerType: "mouse" });
    fireEvent.click(dontImport);

    await waitFor(() => expect(button("next")).toBeDisabled());
  });

  it("does not map anything when the file has no title-like column", async () => {
    await renderWithFile("Foo,Bar\n1,2");
    fireEvent.click(button("next"));

    expect(button("next")).toBeDisabled();
  });

  it("shows the progress count while batches are sent", async () => {
    m.mutateAsync.mockImplementation(
      ({
        onProgress,
      }: {
        onProgress: (done: number, total: number) => void;
      }) => {
        onProgress(200, 450);
        return new Promise(() => {});
      },
    );
    const rows = Array.from({ length: 450 }, (_, index) => `Task ${index}`);
    await renderWithFile(`Title\n${rows.join("\n")}`);
    fireEvent.click(button("next"));
    fireEvent.click(button("next"));
    fireEvent.click(button("import"));

    expect(
      await screen.findByText(
        'settings:tasksImportExport.csv.importing {"done":200,"total":450}',
      ),
    ).toBeInTheDocument();
    expect(button("import")).toBeDisabled();
    expect(button("back")).toBeDisabled();
  });

  it("lists failures and warnings by CSV row in the result", async () => {
    m.mutateAsync.mockResolvedValue(
      outcome({
        total: 3,
        successful: 2,
        failed: 1,
        issues: [
          { index: 1, kind: "error", message: "Not a member" },
          { index: 2, kind: "warning", message: "Cycle skipped" },
        ],
      }),
    );
    await renderWithFile("Title\nA\n\nB\nC");
    fireEvent.click(button("next"));
    fireEvent.click(button("next"));
    fireEvent.click(button("import"));

    expect(
      await screen.findByText(
        'settings:tasksImportExport.csv.result.failed {"count":1}',
      ),
    ).toBeInTheDocument();
    fireEvent.click(button("result.details"));

    // Row 3 is blank, so the second task is on row 4.
    expect(
      await screen.findByText(
        'settings:tasksImportExport.csv.result.row {"row":4,"message":"Not a member"}',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'settings:tasksImportExport.csv.result.row {"row":5,"message":"Cycle skipped"}',
      ),
    ).toBeInTheDocument();
  });

  it("rejects a file that is not a CSV", async () => {
    render(
      <CsvImportDialog
        open
        onOpenChange={vi.fn()}
        project={project}
        initialFile={
          new File(["{}"], "tasks.json", { type: "application/json" })
        }
      />,
    );

    expect(
      await screen.findByText("settings:tasksImportExport.csv.errorNotCsv"),
    ).toBeInTheDocument();
    expect(button("next")).toBeDisabled();
  });
});
