import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JiraImportDialog } from "./jira-import-dialog";

const m = vi.hoisted(() => ({
  preview: vi.fn(),
  importIssues: vi.fn(),
}));

// Interpolation values are appended so assertions can see them.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("@/hooks/mutations/jira-import/use-jira-import", () => ({
  usePreviewJiraImport: () => ({ mutateAsync: m.preview, isPending: false }),
  useImportJiraIssues: () => ({
    mutateAsync: m.importIssues,
    isPending: false,
  }),
}));

const project = {
  id: "p-1",
  columns: [
    { slug: "to-do", name: "To Do", group: "unstarted" },
    { slug: "done", name: "Done", group: "completed" },
  ],
};

const PREVIEW = {
  issueCount: 2,
  columns: [
    { name: "Summary", count: 1 },
    { name: "Labels", count: 3 },
  ],
  statuses: [
    { name: "Closed", category: "Done", count: 2, suggestedStatus: "done" },
  ],
  priorities: [{ name: "Highest", count: 2, suggestedPriority: "urgent" }],
  people: [
    { name: "Ada", count: 1, member: { id: "u1", name: "Ada", email: "a@x" } },
    { name: "Grace", count: 1, member: null },
  ],
  issueTypes: [],
  sprints: [],
  components: [],
  totals: {
    comments: 1,
    attachments: 0,
    subtasks: 0,
    links: 0,
    alreadyImported: 0,
  },
  features: { cycles: false, modules: true, estimates: false },
  permissions: { update: true, comments: false, cycles: true, modules: true },
  warnings: [],
};

function upload(content = "Summary\nA") {
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error("no file input");
  fireEvent.change(input, {
    target: { files: [new File([content], "jira.csv", { type: "text/csv" })] },
  });
}

describe("JiraImportDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it("previews, maps and imports, then shows the summary", async () => {
    m.preview.mockResolvedValue(PREVIEW);
    m.importIssues.mockResolvedValue({
      total: 2,
      created: 1,
      updated: 0,
      skipped: 0,
      failed: 1,
      comments: 0,
      relations: 0,
      unmatchedPeople: ["Grace"],
      errors: [{ line: 3, key: "K-2", message: "The issue has no Summary" }],
      warnings: [],
    });
    render(<JiraImportDialog open onOpenChange={vi.fn()} project={project} />);

    upload();
    expect(
      await screen.findByText(
        'settings:tasksImportExport.jira.issueCount {"count":2}',
      ),
    ).toBeInTheDocument();
    expect(m.preview).toHaveBeenCalledWith({
      projectId: "p-1",
      content: "Summary\nA",
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:tasksImportExport.csv.next",
      }),
    );
    expect(screen.getByRole("combobox", { name: "Closed" })).toHaveTextContent(
      "Done",
    );
    expect(
      screen.getByText(
        'settings:tasksImportExport.jira.peopleUnmatched {"count":1,"names":"Grace"}',
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: 'settings:tasksImportExport.jira.importAction {"count":2}',
      }),
    );
    await waitFor(() => expect(m.importIssues).toHaveBeenCalled());
    // Options the project or the user can't use are sent off.
    expect(m.importIssues.mock.calls[0]?.[0]).toMatchObject({
      projectId: "p-1",
      options: {
        mode: "skip",
        issueTypeAsLabel: true,
        importComments: false,
        sprintsAsCycles: false,
        componentsAsModules: false,
      },
    });
    expect(
      await screen.findByText(
        'settings:tasksImportExport.jira.result.created {"count":1}',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Grace")).toBeInTheDocument();
  });

  it("shows the server's message when the file can't be read", async () => {
    m.preview.mockRejectedValue(
      new Error("This isn't a Jira CSV export: it has no Summary column"),
    );
    render(<JiraImportDialog open onOpenChange={vi.fn()} project={project} />);
    upload("Title\nA");
    expect(
      await screen.findByText(
        "This isn't a Jira CSV export: it has no Summary column",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "settings:tasksImportExport.csv.next",
      }),
    ).toBeDisabled();
  });
});
